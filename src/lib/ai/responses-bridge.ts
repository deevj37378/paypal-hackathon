import { jsonSchema, tool, type ModelMessage, type ToolChoice, type ToolSet } from "ai";

/**
 * Converters between OpenAI Responses-API requests (what AG Studio's adapter sends) and AI SDK
 * calls. Used by /api/studio-ai/responses.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type RespItem = Record<string, any>;

const textOf = (content: any) =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((c: any) => c?.text ?? "").join("") : "";

export function toMessages(input: RespItem[]): ModelMessage[] {
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

export function toTools(tools: RespItem[] | undefined): ToolSet | undefined {
  if (!tools?.length) return undefined;
  const out: ToolSet = {};
  for (const t of tools) {
    // Function names must be unique for every provider; keep the first of any duplicate.
    if (t.type !== "function" || out[t.name]) continue;
    out[t.name] = tool({ description: t.description ?? "", inputSchema: jsonSchema(t.parameters ?? { type: "object" }) });
  }
  return out;
}

export function toToolChoice(choice: any): ToolChoice<ToolSet> | undefined {
  if (choice === "auto" || choice === "none" || choice === "required") return choice;
  if (choice?.type === "function" && choice.name) return { type: "tool", toolName: choice.name };
  return undefined;
}

