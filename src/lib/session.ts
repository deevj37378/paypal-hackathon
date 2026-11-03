import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

/**
 * Stateless signed session (HS256 JWT in an httpOnly cookie).
 * Accounts are per-browser: "Get started" creates a fresh user, so there is no
 * email/password to steal and nothing that costs money (no auth provider, no email sending).
 */
const COOKIE = "alw_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const key = () => new TextEncoder().encode(env().SESSION_SECRET);

export async function createSessionToken(userId: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(key());
}

export async function setSessionCookie(userId: string) {
  (await cookies()).set(COOKIE, await createSessionToken(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(COOKIE);
}

/** The signed-in user's id, or null. */
export async function getSessionUserId(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export class UnauthorizedError extends Error {
  constructor(message = "Sign in first.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/** For route handlers: throws UnauthorizedError (→ 401) when there's no valid session. */
export async function requireUserId(): Promise<string> {
  const id = await getSessionUserId();
  if (!id) throw new UnauthorizedError();
  return id;
}
