#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const modes = ["wrong-api-origin", "database-unavailable", "broken-controller-route"] as const;
for (const mode of modes) {
  const result = spawnSync("pnpm", ["run", "verify:fullstack-smoke"], {
    cwd: process.cwd(),
    env: { ...process.env, FULLSTACK_E2E_MODE: mode },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status === 0) {
    console.error(`[anti-vacuity] ${mode}: expected a nonzero exit, but the gate passed`);
    process.exit(1);
  }
  console.log(`[anti-vacuity] ${mode}: nonzero as required (${result.status})`);
}
console.log("[anti-vacuity] all sabotage modes made the public gate red");
