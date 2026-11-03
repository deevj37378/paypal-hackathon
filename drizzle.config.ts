import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local", quiet: true });

/** `npm run db:push` → dev branch (DATABASE_URL). `npm run db:push:prod` → live DB (PROD_DATABASE_URL). */
const url = process.env.DRIZZLE_TARGET === "prod" ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
if (!url) throw new Error("Database URL missing (see .env.example)");

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
});
