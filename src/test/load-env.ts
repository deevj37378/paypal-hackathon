import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
if (process.env.PROD_DATABASE_URL && process.env.DATABASE_URL === process.env.PROD_DATABASE_URL) {
  throw new Error("Refusing to run DB tests against the live database. Point DATABASE_URL at the Neon dev branch.");
}
