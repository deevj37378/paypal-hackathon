import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Integration tests against a real (dev branch) database: npm run test:db */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["src/**/*.db.test.ts"], testTimeout: 60_000, setupFiles: ["./src/test/load-env.ts"] },
});
