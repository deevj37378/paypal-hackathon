import type { schema } from "@/db";

type Purchase = typeof schema.purchases.$inferSelect;

/** Owner notifications (Telegram in M4). Never throws: a notification failure must not affect money flow. */
export async function notifyPurchase(purchase: Purchase, agentName?: string): Promise<void> {
  void purchase;
  void agentName;
}
