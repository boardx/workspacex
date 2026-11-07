/** #6171: actual seed twice against one isolated database, without Next.
 * Run from workspace root: pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec tsx scripts/verify-brain-seed-replay.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import config from "../playwright.fullstack-smoke.config";
assert(Array.isArray(config.webServer));
const api = config.webServer.find((server) => server.command.includes("scripts/seed-fullstack-smoke.ts"));
assert(api?.env, "official fullstack API setup required");
const commands = api.command.split(" && ");
assert(commands.length === 3 && commands[2]!.includes("start-fullstack-smoke-api.ts"));
for (const [index, command] of [commands.slice(0, 2).join(" && "), commands[1]!].entries()) {
  const result = spawnSync("/bin/sh", ["-c", command], { cwd: process.cwd(), env: { ...process.env, ...api.env }, stdio: "inherit" });
  process.stdout.write(`[brain-seed-replay] seed${index + 1} exit=${result.status}\n`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
process.stdout.write("[brain-seed-replay] same-database repeat succeeded; no Next/server/browser started\n");
