import { db, schema } from "@/db";

/** M1 spike only: a fixed user until real sessions land in M2. */
export const SPIKE_USER_ID = "spike-user";

export async function ensureSpikeUser() {
  await db()
    .insert(schema.users)
    .values({ id: SPIKE_USER_ID, name: "Spike buyer", isDemo: 1 })
    .onConflictDoNothing();
  return SPIKE_USER_ID;
}
