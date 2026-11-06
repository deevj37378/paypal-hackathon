import { ZodError } from "zod";
import { AgentAuthError } from "@/lib/agents";
import { PayPalError } from "@/lib/paypal/client";
import { PurchaseInputError } from "@/lib/purchases/service";
import { RateLimitError } from "@/lib/rate-limit";
import { UnauthorizedError } from "@/lib/session";

const isProd = process.env.NODE_ENV === "production";

/** Uniform JSON errors. Readable messages for expected errors; internals hidden in production. */
export function errorResponse(e: unknown) {
  if (e instanceof ZodError) {
    return Response.json(
      {
        error: "invalid_request",
        message: e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "),
      },
      { status: 400 },
    );
  }
  if (e instanceof UnauthorizedError || e instanceof AgentAuthError) {
    return Response.json({ error: "unauthorized", message: e.message }, { status: 401 });
  }
  if (e instanceof PurchaseInputError) {
    return Response.json({ error: "invalid_request", message: e.message }, { status: 400 });
  }
  if (e instanceof RateLimitError) {
    return Response.json(
      { error: "rate_limited", message: e.message },
      { status: 429, headers: { "Retry-After": String(e.retryAfterSeconds) } },
    );
  }
  if (e instanceof ForbiddenError) {
    return Response.json({ error: "forbidden", message: e.message }, { status: 403 });
  }
  if (e instanceof PayPalError) {
    console.error(`[paypal] ${e.message} debug_id=${e.debugId}`);
    return Response.json(
      {
        error: "paypal_error",
        message: isProd ? "PayPal couldn't complete the request." : e.message,
        debugId: e.debugId,
      },
      { status: 502 },
    );
  }
  console.error(e);
  return Response.json({ error: "internal_error", message: "Something went wrong." }, { status: 500 });
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** CSRF defence for cookie-authenticated state changes (on top of SameSite=Lax). */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients and same-origin navigations without Origin
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host || new URL(origin).host !== host) throw new ForbiddenError("Cross-site request blocked.");
}

/**
 * Stricter same-origin check for endpoints that must only be called by our own pages:
 * the Origin header is required (non-browser clients don't send one) and must match the host.
 */
export function assertSameOriginStrict(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) throw new ForbiddenError("This endpoint only accepts requests from Allowance's own pages.");
}
