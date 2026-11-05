import { randomUUID } from "node:crypto";
import { generateText, jsonSchema, Output, tool, type ModelMessage, type ToolChoice, type ToolSet } from "ai";
import { aiQuota } from "@/lib/ai/limits";
import { getModel } from "@/lib/ai/model";
import { clientIp, rateLimit, RateLimitError } from "@/lib/rate-limit";

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

/* eslint-disable @typescript-eslint/no-explicit-any */
type RespItem = Record<string, any>;

const textOf = (content: any) =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((c: any) => c?.text ?? "").join("") : "";

function toMessages(input: RespItem[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  const toolNames = new Map<string, string>();
  for (const item of input ?? []) {
    if (item.type === "message" || (!item.type && item.role)) {
      const text = textOf(item.content);
      if (!text) continue;
      if (item.role === "assistant") out.push({ role: "assistant", content: [{ type: "text", text }] });
      else if (item.role === "system" || item.role === "developer") out.push({ role: "system", content: text });
      else out.push({ role: "user", content: text });
    } else if (item.type === "function_call") {
      toolNames.set(item.call_id, item.name);
      let args: unknown = {};
      try {
        args = JSON.parse(item.arguments || "{}");
      } catch {
        args = {};
      }
      const part = { type: "tool-call" as const, toolCallId: item.call_id, toolName: item.name, input: args };
      const last = out.at(-1);
      // Consecutive calls belong to one assistant turn.
      if (last?.role === "assistant" && Array.isArray(last.content)) (last.content as any[]).push(part);
      else out.push({ role: "assistant", content: [part] });
    } else if (item.type === "function_call_output") {
      const part = {
        type: "tool-result" as const,
        toolCallId: item.call_id,
        toolName: toolNames.get(item.call_id) ?? "tool",
        output: { type: "text" as const, value: typeof item.output === "string" ? item.output : JSON.stringify(item.output) },
      };
      const last = out.at(-1);
      if (last?.role === "tool") (last.content as any[]).push(part);
      else out.push({ role: "tool", content: [part] });
    }
    // Reasoning items from earlier turns are not replayed.
  }
  return out;
}

function toTools(tools: RespItem[] | undefined): ToolSet | undefined {
  if (!tools?.length) return undefined;
  return Object.fromEntries(
    tools.filter((t) => t.type === "function").map((t) => [t.name, tool({ description: t.description ?? "", inputSchema: jsonSchema(t.parameters ?? { type: "object" }) })]),
  );
}

function toToolChoice(choice: any): ToolChoice<ToolSet> | undefined {
  if (choice === "auto" || choice === "none" || choice === "required") return choice;
  if (choice?.type === "function" && choice.name) return { type: "tool", toolName: choice.name };
  return undefined;
}

const sse = (event: Record<string, unknown>) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

export async function POST(req: Request) {
  try {
    await rateLimit(`studio-ai:ip:${clientIp(req)}`, 80, 3600, "dashboard assistant requests");
    await aiQuota(`studio:${clientIp(req)}`, 80);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return Response.json({ error: { message: `${e.message} The free AI quota is shared by everyone trying the demo.` } }, { status: 429 });
    }
    throw e;
  }

  const model = getModel("studio");
  if (!model) return Response.json({ error: { message: "The dashboard assistant is not configured on this server." } }, { status: 503 });

  let body: RespItem;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: { message: "Request body must be JSON." } }, { status: 400 });
  }

  const tools = toTools(body.tools);
  const format = body.text?.format;
  const wantsJson = format?.type === "json_schema" && format.schema;

  let result;
  try {
    result = await generateText({
      model,
      system: typeof body.instructions === "string" ? body.instructions : undefined,
      messages: toMessages(body.input),
      tools,
      toolChoice: tools ? toToolChoice(body.tool_choice) : undefined,
      ...(wantsJson && !tools ? { output: Output.object({ schema: jsonSchema(format.schema) }) } : {}),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      maxRetries: 1,
      abortSignal: req.signal,
    });
  } catch (e) {
    console.error("[studio-ai] turn failed:", (e as Error).message?.slice(0, 300));
    const busy = /quota|rate|429|overloaded|503/i.test((e as Error).message ?? "");
    return Response.json(
      { error: { message: busy ? "The free AI models are busy for a moment. Please send your message again." : "The assistant couldn't complete that step." } },
      { status: busy ? 429 : 502 },
    );
  }

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
