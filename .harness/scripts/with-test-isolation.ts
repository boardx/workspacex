#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureTestIsolation } from "./lib/test-isolation";

const separator = process.argv.indexOf("--");
const command = separator >= 0 ? process.argv.slice(separator + 1) : process.argv.slice(2);
if (command.length === 0) {
  console.error("usage: with-test-isolation -- <command> [args...]");
  process.exit(2);
}

const isolation = ensureTestIsolation(process.env);
const env = { ...process.env, ...isolation };
console.log(
  `[test-isolation] id=${isolation.WORKSPACEX_ISOLATION_ID} db=${isolation.WORKSPACEX_DB} ` +
  `compose=${isolation.COMPOSE_PROJECT_NAME} pg=${isolation.PGPORT} redis=${isolation.REDIS_PORT}`,
);

const result = spawnSync(command[0]!, command.slice(1), { env, stdio: "inherit" });
if (process.env.WORKSPACEX_KEEP_TEST_STACK !== "1") {
  const composeFile = fileURLToPath(new URL("../../apps/api/docker-compose.dev.yml", import.meta.url));
  spawnSync(
    "docker",
    ["compose", "-f", composeFile, "-p", isolation.COMPOSE_PROJECT_NAME, "down", "-v"],
    { env, stdio: "ignore" },
  );
}
if (result.error) {
  console.error(`[test-isolation] failed to start ${command[0]}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
