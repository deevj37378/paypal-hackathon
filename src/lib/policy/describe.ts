import { formatUsd } from "@/lib/money";
import type { PolicyRules } from "./schema";

/** Readable rule cards for humans (rules page, confirmation step). Pure. */
export type RuleCard = { id: keyof PolicyRules | "categories" | "merchants"; title: string; value: string; kind: "limit" | "approval" | "scope" };

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** `names` maps merchant ids to display names ("demo-store" → "Bean & Page"). */
export function ruleCards(r: PolicyRules, names: Record<string, string> = {}): RuleCard[] {
  const m = (ids: string[]) => list(ids.map((id) => names[id] ?? id));
  return [
    { id: "monthlyLimitCents", title: "Monthly allowance", value: `${formatUsd(r.monthlyLimitCents)} per month`, kind: "limit" },
    {
      id: "perOrderLimitCents",
      title: "Per order",
      value: r.perOrderLimitCents === null ? "No per-order cap" : `Max ${formatUsd(r.perOrderLimitCents)} per order`,
      kind: "limit",
    },
    {
      id: "approvalThresholdCents",
      title: "Ask me first",
      value: r.approvalThresholdCents === null ? "Never ask based on amount" : `Ask before anything over ${formatUsd(r.approvalThresholdCents)}`,
      kind: "approval",
    },
    {
      id: "requireApprovalForNewMerchants",
      title: "New merchants",
      value: r.requireApprovalForNewMerchants ? "Ask before buying from a new merchant" : "New merchants are fine",
      kind: "approval",
    },
    {
      id: "categories",
      title: "What it can buy",
      value:
        (r.allowedCategories.length ? `Only ${list(r.allowedCategories)}` : "Any category") +
        (r.blockedCategories.length ? `; never ${list(r.blockedCategories)}` : ""),
      kind: "scope",
    },
    {
      id: "merchants",
      title: "Merchants",
      value:
        [
          r.trustedMerchants.length ? `Trusted: ${m(r.trustedMerchants)}` : "",
          r.blockedMerchants.length ? `Blocked: ${m(r.blockedMerchants)}` : "",
        ]
          .filter(Boolean)
          .join(" · ") || "No merchant lists",
      kind: "scope",
    },
  ];
}

/** Which cards change between the current and proposed rules (for highlighting before confirm). */
export function diffRules(current: PolicyRules | null, next: PolicyRules, names: Record<string, string> = {}) {
  const before = new Map((current ? ruleCards(current, names) : []).map((c) => [c.id, c.value]));
  return ruleCards(next, names).map((c) => ({ ...c, before: before.get(c.id) ?? null, changed: before.get(c.id) !== c.value }));
}
