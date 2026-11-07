"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Result = { valid: boolean; error?: string; payload?: Record<string, unknown>; header?: { kid?: string; typ?: string } };

export function Verifier() {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const verify = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const data = await res.json();
      setResult(res.ok ? data : { valid: false, error: data.message ?? "Couldn't verify that." });
    } finally {
      setBusy(false);
    }
  };

  const p = result?.payload as { ap2?: { mandate_type?: string }; allowance?: Record<string, unknown>; jti?: string } | undefined;
  return (
    <div className="space-y-3">
      <label htmlFor="token" className="text-sm font-medium">
        Signed mandate or receipt (starts with eyJ…)
      </label>
      <textarea
        id="token"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        rows={5}
        spellCheck={false}
        className="w-full resize-y rounded-lg border bg-background p-3 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <Button onClick={verify} disabled={busy || token.trim().length < 20}>
        {busy ? "Verifying…" : "Verify signature"}
      </Button>
      {result && (
        <div role="status" className={`space-y-2 rounded-xl border p-4 text-sm ${result.valid ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50"}`}>
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {result.valid ? (
              <Badge className="bg-emerald-100 text-emerald-800">✓ Valid: signed by Allowance</Badge>
            ) : (
              <Badge className="bg-red-100 text-red-800">✗ Not valid</Badge>
            )}
            {p?.ap2?.mandate_type && <span className="text-muted-foreground">{p.ap2.mandate_type === "PaymentMandate" ? "Purchase receipt" : "IntentMandate"} {p.jti}</span>}
          </p>
          {result.error && <p className="text-red-900">{result.error}</p>}
          {p && (
            <pre className="max-h-96 overflow-auto rounded-lg bg-background p-3 text-xs">{JSON.stringify(p.allowance ?? p, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
}
