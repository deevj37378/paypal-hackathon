import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";

/** API keys look like `alw_sk_<43 chars>`. Only the sha256 hash is stored. */
const PREFIX = "alw_sk_";

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export async function createAgent(userId: string, name: string) {
  const key = PREFIX + randomBytes(32).toString("base64url");
  const agent = {
    id: newId("agt"),
    userId,
    name,
    keyHash: hashKey(key),
    keyPrefix: PREFIX,
    keyLast4: key.slice(-4),
  };
  await db().insert(schema.agents).values(agent);
  return { agent, key }; // key is returned exactly once
}

/** Kill switch for every agent of this user at once. */
export async function revokeAllAgents(userId: string) {
  const rows = await db()
    .update(schema.agents)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(and(eq(schema.agents.userId, userId), eq(schema.agents.status, "active")))
    .returning({ id: schema.agents.id });
  return rows.length;
}

/** Kill switch: revoked keys stop working on the very next request. */
export async function revokeAgent(userId: string, agentId: string) {
  const [row] = await db()
    .update(schema.agents)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.userId, userId)))
    .returning({ id: schema.agents.id });
  return Boolean(row);
}

export class AgentAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentAuthError";
  }
}

/** Resolve an agent from an `Authorization: Bearer alw_sk_…` header. */
export async function authenticateAgent(authorization: string | null) {
  const key = authorization?.match(/^Bearer\s+(alw_sk_[A-Za-z0-9_-]{20,})$/)?.[1];
  if (!key) throw new AgentAuthError("Missing or malformed API key. Use: Authorization: Bearer alw_sk_…");
  const [agent] = await db().select().from(schema.agents).where(eq(schema.agents.keyHash, hashKey(key))).limit(1);
  if (!agent) throw new AgentAuthError("Unknown API key.");
  if (agent.status !== "active") throw new AgentAuthError("This agent's access was revoked by its owner.");
  touchAgent(agent.id);
  return agent;
}

/**
 * The built-in chat agent's identity. It has an agent row (so the kill switch, limits and audit trail
 * apply exactly like any MCP agent) but no usable API key: its hash is of random bytes nobody holds.
 */
export async function getBuiltinAgent(userId: string, opts: { create?: boolean } = {}) {
  const [existing] = await db()
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.userId, userId), eq(schema.agents.keyPrefix, "builtin")))
    .orderBy(desc(schema.agents.createdAt))
    .limit(1);
  // A revoked built-in agent stays revoked (kill switch) until the owner explicitly re-enables it.
  if (existing || !opts.create) return existing ?? null;
  return createBuiltinAgent(userId);
}

/** Explicit owner action: create a fresh built-in agent identity (e.g. after revoking the old one). */
export async function createBuiltinAgent(userId: string) {
  const agent = { id: newId("agt"), userId, name: "Built-in assistant", keyHash: hashKey(randomBytes(32).toString("hex")), keyPrefix: "builtin", keyLast4: null };
  const [row] = await db().insert(schema.agents).values(agent).returning();
  return row;
}

/** Re-read an agent by id and refuse if revoked (used by the built-in agent on every tool call). */
export async function requireActiveAgent(agentId: string) {
  const [a] = await db().select().from(schema.agents).where(eq(schema.agents.id, agentId)).limit(1);
  if (!a) throw new AgentAuthError("Unknown agent.");
  if (a.status !== "active") throw new AgentAuthError("This agent's access was revoked by its owner.");
  touchAgent(a.id);
  return a;
}

/** Fire-and-forget "last used" stamp; a failure must never block the request. */
export function touchAgent(agentId: string) {
  db()
    .update(schema.agents)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.agents.id, agentId))
    .catch(() => {});
}
