/** Guided demo scenarios: each one is a real request_purchase made by the account's built-in agent. */
export const DEMO_SCENARIOS = {
  coffee: {
    label: "Agent buys coffee",
    detail: "$18, within your rules",
    expect: "Charged automatically to PayPal",
    input: { merchant_id: "demo-store", items: [{ product_id: "coffee-house-blend", quantity: 1 }], total: "18.00", currency: "USD", reason: "You're almost out of coffee: restocking your usual house blend." },
  },
  book: {
    label: "Agent buys a $32 book",
    detail: "Over your $25 ask-me threshold",
    expect: "Held for your approval",
    input: { merchant_id: "demo-store", items: [{ product_id: "book-pragmatic", quantity: 1 }], total: "32.00", currency: "USD", reason: "The book you mentioned: The Pragmatic Programmer." },
  },
  mug: {
    label: "Agent tries a mug",
    detail: "Kitchen isn't an allowed category",
    expect: "Blocked, with a reason",
    input: { merchant_id: "demo-store", items: [{ product_id: "mug-ceramic", quantity: 1 }], total: "15.00", currency: "USD", reason: "A mug to go with the coffee." },
  },
  newStore: {
    label: "Agent tries a new store",
    detail: "Coffee, but from Gadget Hub",
    expect: "Held: new merchant",
    input: { merchant_id: "gadget-hub", items: [{ product_id: "coffee-cold-brew-kit", quantity: 1 }], total: "24.00", currency: "USD", reason: "A cold brew kit for summer." },
  },
} as const;

export type DemoScenario = keyof typeof DEMO_SCENARIOS;
