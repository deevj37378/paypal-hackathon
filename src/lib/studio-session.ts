import { randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

/**
 * Per-browser session for the public analytics assistant (/store/analytics). Anonymous, but it
 * lets us require a real page visit and rate-limit per browser, so the AI proxy can't be used as a
 * free LLM endpoint by scripts.
 */
const COOKIE = "alw_studio";
const TTL = 12 * 3600;
const key = () => new TextEncoder().encode(env().SESSION_SECRET);

/** Returns the existing session, or issues a new one (`fresh` tells the caller to rate-limit it). */
export async function issueStudioSession(): Promise<{ sid: string; fresh: boolean }> {
  const existing = await getStudioSessionId();
  if (existing) return { sid: existing, fresh: false };
  const sid = randomUUID();
  const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(sid).setAudience("studio").setIssuedAt().setExpirationTime(`${TTL}s`).sign(key());
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/api/studio-ai", maxAge: TTL });
  return { sid, fresh: true };
}

export async function getStudioSessionId(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"], audience: "studio" });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
