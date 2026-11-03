// Runs a command with DATABASE_URL set to PROD_DATABASE_URL from .env.local (values never printed).
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const line = readFileSync(".env.local", "utf8").split("\n").find((l) => l.startsWith("PROD_DATABASE_URL="));
if (!line) throw new Error("PROD_DATABASE_URL missing in .env.local");
const [cmd, ...args] = process.argv.slice(2);
const r = spawnSync("npx", [cmd, ...args], { stdio: "inherit", env: { ...process.env, DATABASE_URL: line.slice(line.indexOf("=") + 1) } });
process.exit(r.status ?? 1);
