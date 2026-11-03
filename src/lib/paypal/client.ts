import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";

/** Error carrying PayPal's debug_id so failures can be traced in the dashboard. */
export class PayPalError extends Error {
  constructor(
    message: string,
    public status: number,
    public debugId: string | undefined,
    public details: unknown,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

let tokenCache: { token: string; expiresAt: number } | undefined;

function basicAuth() {
  const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = env();
  return "Basic " + Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64");
}

/** OAuth2 client-credentials access token, cached until ~60s before expiry. */
export async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const res = await fetch(`${env().PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new PayPalError(
      `PayPal OAuth failed: ${data.error_description ?? res.statusText}`,
      res.status,
      res.headers.get("paypal-debug-id") ?? undefined,
      data,
    );
  }
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return tokenCache.token;
}

type PayPalFetchOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Idempotency key. Auto-generated for POSTs if omitted — pass a stable one to make retries safe. */
  requestId?: string;
  headers?: Record<string, string>;
  /** Max retries on 429 / 5xx (exponential backoff). */
  retries?: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Typed PayPal REST call with idempotency, retries and debug_id logging. */
export async function paypalFetch<T = unknown>(path: string, opts: PayPalFetchOptions = {}): Promise<T> {
  const method = opts.method ?? (opts.body === undefined ? "GET" : "POST");
  const requestId = method === "POST" ? (opts.requestId ?? randomUUID()) : undefined;
  const maxRetries = opts.retries ?? 3;

  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await getAccessToken()}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
      ...opts.headers,
    };
    const res = await fetch(`${env().PAYPAL_API_BASE}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: "no-store",
    });
    const debugId = res.headers.get("paypal-debug-id") ?? undefined;
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};

    if (res.ok) return data as T;

    if (res.status === 401 && attempt === 0) {
      tokenCache = undefined; // token revoked/expired early — refresh once
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      await sleep(2 ** attempt * 500 + Math.random() * 250);
      continue;
    }
    const detail = data?.details?.[0];
    const message = `${method} ${path} → ${res.status} ${data?.name ?? ""}: ${
      detail ? `${detail.issue} ${detail.description ?? ""}` : (data?.message ?? res.statusText)
    }`.trim();
    console.error(`[paypal] ${message} (debug_id=${data?.debug_id ?? debugId})`);
    throw new PayPalError(message, res.status, data?.debug_id ?? debugId, data);
  }
}
