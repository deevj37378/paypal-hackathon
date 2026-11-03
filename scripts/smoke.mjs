#!/usr/bin/env node
/**
 * Smoke test against a running deployment (no PayPal approval needed).
 *   node scripts/smoke.mjs https://allowance-eight-eta.vercel.app
 * Creates a throwaway account and agent, then checks auth, validation and the locked purchase path.
 */
const base = (process.argv[2] ?? "http://localhost:3100").replace(/\/$/, "");
let cookie = "";
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
};
const req = async (path, init = {}) => {
  const res = await fetch(base + path, {
    redirect: "manual",
    ...init,
    headers: { Origin: base, ...(cookie ? { Cookie: cookie } : {}), ...(init.headers ?? {}) },
  });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
};

const health = await req("/api/health");
check("health", health.status === 200 && health.json?.ok === true, JSON.stringify(health.json));
check("home page", (await req("/")).status === 200);
check("client-token needs session", (await req("/api/paypal/client-token")).status === 401);
check("cron needs secret", (await req("/api/cron/payouts")).status === 401);
const s = await req("/api/session", { method: "POST" });
check("create session", s.status === 303 && cookie.startsWith("alw_session="));
const agent = await req("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "smoke" }) });
check("create agent key", agent.status === 201 && agent.json?.key?.startsWith("alw_sk_"));
const key = agent.json?.key;
const buy = await req("/api/v1/purchases", {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({ merchant_id: "demo-store", items: [{ product_id: "coffee-house-blend", quantity: 1 }], total: "18.00", currency: "USD" }),
});
check("purchase w/o PayPal is blocked (locked path works)", buy.json?.status === "blocked", buy.json?.reasons?.[0] ?? buy.text.slice(0, 120));
// MCP: initialize + tools/list + one tool call over Streamable HTTP
const mcp = async (id, method, params = {}) => {
  const r = await req("/api/mcp", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const body = r.json ?? JSON.parse(r.text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5)).join("") || "null");
  return { status: r.status, body };
};
await mcp(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } });
const tools = await mcp(2, "tools/list");
const names = tools.body?.result?.tools?.map((t) => t.name).sort().join(",");
check("MCP tools/list", names === "get_allowance_status,get_purchase_status,request_purchase,search_store", names ?? String(tools.status));
const st = await mcp(3, "tools/call", { name: "get_allowance_status", arguments: {} });
check("MCP get_allowance_status", /PayPal/.test(st.body?.result?.content?.[0]?.text ?? ""), (st.body?.result?.content?.[0]?.text ?? "").slice(0, 80));
check("MCP refuses missing key", (await req("/api/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: "{}" })).status === 401);
const bad = await req("/api/v1/purchases", { method: "POST", headers: { Authorization: "Bearer alw_sk_nope_nope_nope_nope_nope", "Content-Type": "application/json" }, body: "{}" });
check("bad key refused", bad.status === 401);
const xsite = await req("/api/agents", { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: '{"name":"x"}' });
check("cross-site POST refused", xsite.status === 403);
for (const extra of process.argv.slice(3)) {
  const r = await req(extra);
  check(`GET ${extra}`, r.status < 400, String(r.status));
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
