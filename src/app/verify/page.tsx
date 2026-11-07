import Link from "next/link";
import { SiteHeader } from "@/components/app/site-header";
import { Verifier } from "./verifier";

export const metadata = { title: "Verify a signed mandate or receipt · Allowance" };

export default function VerifyPage() {
  return (
    <>
      <SiteHeader>
        <Link href="/security" className="text-sm text-muted-foreground hover:text-foreground">
          Security
        </Link>
      </SiteHeader>
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-10 sm:px-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Verify a signed mandate or receipt</h1>
          <p className="text-muted-foreground">
            Allowance signs every owner&apos;s rules as an AP2-style IntentMandate and every charged purchase as a signed receipt
            (compact JWS, ES256). Paste one below. It&apos;s checked against the public key at{" "}
            <a className="underline underline-offset-2" href="/.well-known/jwks.json">
              /.well-known/jwks.json
            </a>
            , the same check the demo store runs before it fulfils an order.
          </p>
        </div>
        <Verifier />
        <section className="space-y-2 rounded-xl border bg-muted/30 p-5 text-sm">
          <h2 className="font-semibold">Verify it yourself, without trusting this page</h2>
          <p className="text-muted-foreground">With Node.js and the jose library:</p>
          <pre className="overflow-x-auto rounded-lg bg-background p-3 text-xs">{`import { createRemoteJWKSet, jwtVerify } from "jose";
const jwks = createRemoteJWKSet(new URL("https://allowance-eight-eta.vercel.app/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, jwks, { algorithms: ["ES256"] });
console.log(payload.allowance);`}</pre>
          <p className="text-muted-foreground">
            These follow the shape of AP2 (Agent Payments Protocol) v0.2 mandates. They are AP2-style, not a certified AP2
            implementation.
          </p>
        </section>
      </main>
    </>
  );
}
