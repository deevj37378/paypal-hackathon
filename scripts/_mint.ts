import { writeFileSync } from "node:fs";
import { createSessionToken } from "@/lib/session";
(async () => { writeFileSync(process.argv[3], await createSessionToken(process.argv[2])); process.exit(0); })();
