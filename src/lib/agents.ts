import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
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
    keyPrefix: key.slice(0, PREFIX.length + 4),
  };
  await db().insert(schema.agents).values(agent);
  return { agent, key }; // key is returned exactly once
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
  // Fire-and-forget usage stamp; failure must not block the request.
  db()
    .update(schema.agents)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.agents.id, agent.id))
    .catch(() => {});
  return agent;
}
