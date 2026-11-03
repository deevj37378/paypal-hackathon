import { ZodError } from "zod";
import { PayPalError } from "@/lib/paypal/client";

/** Uniform JSON error response; never leaks secrets, includes PayPal debug_id for tracing. */
export function errorResponse(e: unknown) {
  if (e instanceof ZodError) {
    return Response.json({ error: "invalid_request", issues: e.issues }, { status: 400 });
  }
  if (e instanceof PayPalError) {
    return Response.json(
      { error: "paypal_error", message: e.message, debugId: e.debugId },
      { status: e.status >= 400 && e.status < 600 ? e.status : 502 },
    );
  }
  console.error(e);
  return Response.json({ error: "internal_error" }, { status: 500 });
}
