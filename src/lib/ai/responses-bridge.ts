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
    out[t.name] = tool({ description: t.description ?? "", inputSchema: jsonSchema((trimToolSchema(t.name, t.parameters ?? { type: "object" }) ?? { type: "object" }) as any) });
  }
  return out;
}

export function toToolChoice(choice: any): ToolChoice<ToolSet> | undefined {
  if (choice === "auto" || choice === "none" || choice === "required") return choice;
  if (choice?.type === "function" && choice.name) return { type: "tool", toolName: choice.name };
  return undefined;
}


/**
 * Trim a Studio tool schema to what the analyst agent needs, to keep each turn small:
 * nested descriptions/examples go, `format.style` subtrees (visual styling) go, and the filter tool
 * keeps only its text and date variants. A subset of the schema is still valid for Studio.
 */
export function trimToolSchema(name: string, schema: unknown): unknown {
  const walk = (node: any, depth: number): any => {
    if (Array.isArray(node)) return node.map((n) => walk(n, depth + 1));
    if (!node || typeof node !== "object") return node;
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(node)) {
      if ((k === "description" && typeof v === "string" && depth > 1) || k === "examples") continue;
      out[k] = walk(v, depth + 1);
    }
    const props = out.properties;
    if (props?.format?.properties?.style) {
      delete props.format.properties.style;
      if (Array.isArray(props.format.required)) props.format.required = props.format.required.filter((r: string) => r !== "style");
    }
    return out;
  };
  const trimmed = walk(schema, 0);
  if (name === "add_widget_filter" && Array.isArray(trimmed?.properties?.value?.anyOf)) {
    trimmed.properties.value.anyOf = trimmed.properties.value.anyOf.filter((b: any) => /inRelativeRange|"contains"/.test(JSON.stringify(b)));
  }
  return trimmed;
}

/** Keep the first user message plus the most recent items; cap long tool outputs. */
export function capHistory(input: RespItem[], keep = 16, maxOutputChars = 3000): RespItem[] {
  const items = (input ?? []).map((i) =>
    i.type === "function_call_output" && typeof i.output === "string" && i.output.length > maxOutputChars
      ? { ...i, output: `${i.output.slice(0, maxOutputChars)}… (truncated)` }
      : i,
  );
  if (items.length <= keep + 1) return items;
  const first = items.find((i) => i.type === "message" && i.role === "user");
  let tail = items.slice(-keep);
  // Never start the tail with a tool result whose call was cut off.
  while (tail.length && tail[0].type === "function_call_output") tail = tail.slice(1);
  return first && !tail.includes(first) ? [first, ...tail] : tail;
}
