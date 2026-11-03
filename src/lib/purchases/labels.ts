/** Shared, human-readable status labels (dashboard, detail page, store). */
export const PURCHASE_STATUS: Record<string, { label: string; className: string }> = {
  captured: { label: "Paid", className: "bg-emerald-100 text-emerald-800" },
  processing: { label: "Processing", className: "bg-sky-100 text-sky-800" },
  pending_approval: { label: "Needs approval", className: "bg-amber-100 text-amber-900" },
  blocked: { label: "Blocked", className: "bg-red-100 text-red-800" },
  declined: { label: "Declined", className: "bg-zinc-100 text-zinc-700" },
  expired: { label: "Expired", className: "bg-zinc-100 text-zinc-700" },
  failed: { label: "Failed", className: "bg-red-100 text-red-800" },
  refunded: { label: "Refunded", className: "bg-violet-100 text-violet-800" },
};

export const PAYOUT_STATUS: Record<string, string> = {
  none: "",
  scheduled: "Store payout on hold (refund window)",
  processing: "Paying the store…",
  sent: "Paying the store…",
  paid: "Store paid",
  cancelled: "Store payout cancelled",
  failed: "Store payout failed",
};
