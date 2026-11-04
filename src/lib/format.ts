/**
 * Deterministic date formatting (same output on server and in the browser, so no hydration
 * mismatches): "Nov 5, 1:43 AM UTC".
 */
const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });
export const formatWhen = (d: Date | string) => `${fmt.format(typeof d === "string" ? new Date(d) : d)} UTC`;
