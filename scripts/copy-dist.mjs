// Copies the client build (packages/client/dist) to ./dist so hosts that expect
// a top-level "dist" folder (like Vercel's default) find it.
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "packages", "client", "dist");
const to = join(root, "dist");

if (!existsSync(from)) {
  console.error(`Client build output not found at ${from}`);
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log(`Copied ${from} -> ${to}`);
