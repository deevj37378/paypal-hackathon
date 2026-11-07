/** Shared (server + client) wording for one-time allowances. */
export const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

export const STATE: Record<"active" | "used" | "expired" | "cancelled", { label: string; className: string }> = {
  active: { label: "Active", className: "bg-emerald-100 text-emerald-800" },
  used: { label: "Used", className: "bg-sky-100 text-sky-900" },
  expired: { label: "Expired", className: "bg-zinc-200 text-zinc-700" },
  cancelled: { label: "Cancelled", className: "bg-zinc-200 text-zinc-700" },
};

export function grantScope(g: { amountCents: number; category: string | null; merchantId: string | null }, names: Record<string, string>) {
  return `One purchase up to ${usd(g.amountCents)}${g.category ? `, ${g.category} only` : ", any category"}${g.merchantId ? `, at ${names[g.merchantId] ?? g.merchantId}` : ", any store"}`;
}

