import { desc } from "drizzle-orm";
import { db, schema } from "@/db";
(async () => {
  const rows = await db().select().from(schema.webhookEvents).orderBy(desc(schema.webhookEvents.receivedAt)).limit(10);
  for (const r of rows) console.log(r.receivedAt.toISOString(), r.type, r.id.slice(0, 30), "→", r.outcome);
  if (!rows.length) console.log("(no webhook events recorded on live DB)");
  process.exit(0);
})();
