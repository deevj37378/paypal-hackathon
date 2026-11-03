/** All money is handled as integer cents. Never use floats for amounts. */
export const toCents = (value: string): number => {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error(`Invalid amount: ${value}`);
  const [whole, frac = ""] = value.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
};

/** 1800 → "18.00" (PayPal API string format). */
export const centsToValue = (cents: number): string => {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`Invalid cents: ${cents}`);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
};

/** 1800 → "$18.00" */
export const formatUsd = (cents: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
