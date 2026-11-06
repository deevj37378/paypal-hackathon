import { randomUUID } from "node:crypto";
import { generateText, jsonSchema, Output } from "ai";
import { capHistory, type RespItem, toMessages, toToolChoice, toTools } from "@/lib/ai/responses-bridge";
import { aiQuota } from "@/lib/ai/limits";
import { getModel, runWithChain } from "@/lib/ai/model";
import { assertSameOriginStrict, ForbiddenError } from "@/lib/http";
import { clientIp, rateLimit, RateLimitError } from "@/lib/rate-limit";
import { getStudioSessionId } from "@/lib/studio-session";

/**
 * Bridge for AG Studio's AI assistant on /store/analytics.
 *
 * Studio's (unchanged) OpenAI adapter sends OpenAI Responses-API requests here. We translate them
 * into one AI SDK turn on Allowance's own free model chain (Gemini first, Groq fallbacks; see
 * src/lib/ai/model.ts), then stream the result back as the Responses-API events the adapter reads.
 *
 * Tools are declared without `execute`: the model only proposes calls, and Studio executes its own
 * dashboard tools in the browser. This route has no access to purchases, approvals or refunds.
 */
export const maxDuration = 120;

const MAX_OUTPUT_TOKENS = 6000;
/** Studio turns are ~40 KB after trimming; anything far larger isn't from our page. */
const MAX_BODY_BYTES = 400_000;

const sse = (event: Record<string, unknown>) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

export async function POST(req: Request) {
  // Only our own page, with a per-browser session, may use the shared free AI quota.
  try {
    assertSameOriginStrict(req);
  } catch (e) {
    if (e instanceof ForbiddenError) return Response.json({ error: { message: e.message } }, { status: 403 });
    throw e;
  }
  const sid = await getStudioSessionId();
  if (!sid) return Response.json({ error: { message: "Your dashboard session expired. Reload the page to use the assistant." } }, { status: 401 });
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return Response.json({ error: { message: "Request too large." } }, { status: 413 });
  try {
    await rateLimit(`studio-ai:sid:${sid}`, 60, 3600, "assistant requests from this browser");
    await rateLimit(`studio-ai:ip:${clientIp(req)}`, 120, 3600, "dashboard assistant requests");
    await aiQuota(`studio:${sid}`, 60);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return Response.json({ error: { message: `${e.message} The free AI quota is shared by everyone trying the demo.` } }, { status: 429 });
    }
    throw e;
  }

  if (!getModel("studio")) return Response.json({ error: { message: "The dashboard assistant is not configured on this server." } }, { status: 503 });

  let body: RespItem;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return Response.json({ error: { message: "Request too large." } }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: { message: "Request body must be JSON." } }, { status: 400 });
  }

  // Dev-only: dump the last request for debugging schema issues.
  if (process.env.NODE_ENV !== "production" && process.env.STUDIO_AI_DUMP) {
    await import("node:fs").then((fs) => fs.writeFileSync(process.env.STUDIO_AI_DUMP!, JSON.stringify(body)));
  }
  const tools = toTools(body.tools);
  const format = body.text?.format;
  const wantsJson = format?.type === "json_schema" && format.schema;

  const messages = toMessages(capHistory(body.input));
  const system = typeof body.instructions === "string" ? body.instructions : undefined;
  const toolChoice = tools ? toToolChoice(body.tool_choice) : undefined;

  // One turn, model by model: a model that errors OR returns an empty turn (no text, no tool calls)
  // hands over to the next one, so the assistant never stops silently.
  let result: Awaited<ReturnType<typeof generateText>> | null = null;
  try {
    result = await runWithChain(
      "studio",
      (m) =>
        generateText({
          model: m,
          system,
          messages,
          tools,
          toolChoice,
          ...(wantsJson && !tools ? { output: Output.object({ schema: jsonSchema(format.schema) }) } : {}),
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          maxRetries: 0,
          abortSignal: req.signal,
        }),
      (r) => Boolean(r.text?.trim()) || r.toolCalls.length > 0 || (wantsJson && r.output !== undefined),
    );
  } catch (e) {
    console.error("[studio-ai] turn failed:", (e as Error).message?.slice(0, 300));
    const busy = /quota|rate|429|overloaded|503/i.test((e as Error).message ?? "");
    if (!busy) {
      return Response.json({ error: { message: "The assistant couldn't complete that step." } }, { status: 502 });
    }
  }
  if (!result) {
    // Every model was busy or empty: answer with a short message instead of hanging.
    const fallback = "The free AI models are busy right now, so I stopped here. Please ask again in a minute.";
    return new Response(
      sse({ type: "response.output_item.added", item: { id: "msg_busy", type: "message", role: "assistant", status: "in_progress", content: [] } }) +
        sse({ type: "response.output_text.delta", item_id: "msg_busy", delta: fallback }) +
        sse({ type: "response.output_item.done", item: { id: "msg_busy", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: fallback, annotations: [] }] } }) +
        sse({ type: "response.completed", response: { id: `resp_${randomUUID()}`, created_at: Math.floor(Date.now() / 1000), model: "allowance-ai", status: "completed", output: [{ id: "msg_busy", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: fallback, annotations: [] }] }] } }),
      { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } },
    );
  }

  console.log(`[studio-ai] turn ok model=${result.response?.modelId} in=${result.usage?.inputTokens} out=${result.usage?.outputTokens} calls=${result.toolCalls.map((c) => c.toolName).join(",") || "-"}`);

  // Emit the turn as OpenAI Responses-API stream events (the subset the adapter reads).
  const responseId = `resp_${randomUUID()}`;
  const output: RespItem[] = [];
  let stream = sse({ type: "response.created", response: { id: responseId, status: "in_progress" } });

  const text = wantsJson && !tools && result.output !== undefined ? JSON.stringify(result.output) : result.text;
  if (text) {
    const id = `msg_${randomUUID()}`;
    const item = { id, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] };
    stream += sse({ type: "response.output_item.added", item: { ...item, status: "in_progress", content: [] } });
    stream += sse({ type: "response.output_text.delta", item_id: id, delta: text });
    stream += sse({ type: "response.output_item.done", item });
    output.push(item);
  }
  for (const call of result.toolCalls) {
    const id = `fc_${randomUUID()}`;
    const args = JSON.stringify(call.input ?? {});
    const item = { id, type: "function_call", call_id: call.toolCallId || `call_${randomUUID()}`, name: call.toolName, arguments: args, status: "completed" };
    stream += sse({ type: "response.output_item.added", item: { ...item, arguments: "", status: "in_progress" } });
    stream += sse({ type: "response.function_call_arguments.delta", item_id: id, delta: args });
    stream += sse({ type: "response.output_item.done", item });
    output.push(item);
  }
  stream += sse({
    type: "response.completed",
    response: {
      id: responseId,
      created_at: Math.floor(Date.now() / 1000),
      model: result.response?.modelId ?? "allowance-ai",
      status: "completed",
      output,
      usage: {
        input_tokens: result.usage?.inputTokens ?? 0,
        output_tokens: result.usage?.outputTokens ?? 0,
        total_tokens: result.usage?.totalTokens ?? 0,
      },
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
}
