#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureTestIsolation } from "./lib/test-isolation";

async function main(): Promise<void> {
  const separator = process.argv.indexOf("--");
  const command = separator >= 0 ? process.argv.slice(separator + 1) : process.argv.slice(2);
  if (command.length === 0) {
    console.error("usage: with-test-isolation -- <command> [args...]");
    process.exit(2);
  }

  const isolation = ensureTestIsolation(process.env);
  const env = { ...process.env, ...isolation };
  const verifyOuterDb = process.env.WORKSPACEX_VERIFY_OUTER_DB;
  const verifyOuterCompose = process.env.WORKSPACEX_VERIFY_OUTER_COMPOSE;
  if (verifyOuterDb !== undefined || verifyOuterCompose !== undefined) {
    const matched = verifyOuterDb === isolation.WORKSPACEX_DB &&
      verifyOuterCompose === isolation.COMPOSE_PROJECT_NAME;
    const message = `[harness-isolation] outer_db=${verifyOuterDb ?? "missing"} ` +
      `inner_db=${isolation.WORKSPACEX_DB} outer_compose=${verifyOuterCompose ?? "missing"} ` +
      `inner_compose=${isolation.COMPOSE_PROJECT_NAME} status=${matched ? "matched" : "mismatch"}`;
    if (!matched) {
      console.error(message);
      process.exit(2);
    }
    console.log(message);
  }

  let cleaned = false;
  function cleanup(): string | null {
    if (cleaned || process.env.WORKSPACEX_KEEP_TEST_STACK === "1") return null;
    cleaned = true;
    const composeFile = fileURLToPath(new URL("../../apps/api/docker-compose.dev.yml", import.meta.url));
    const cleanupResult = spawnSync(
      "docker",
      ["compose", "-f", composeFile, "-p", isolation.COMPOSE_PROJECT_NAME, "down", "-v"],
      { env, stdio: "ignore" },
    );
    if (cleanupResult.error) return cleanupResult.error.message;
    if (cleanupResult.status !== 0) {
      return `docker compose down -v exited ${cleanupResult.status ?? "without a status"}`;
    }
    return null;
  }

  const child = spawn(command[0]!, command.slice(1), { env, stdio: "inherit" });
  let receivedSignal: NodeJS.Signals | null = null;
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(signal, () => {
      receivedSignal = signal;
      child.kill(signal);
    });
  }
  console.log(
    `[test-isolation] id=${isolation.WORKSPACEX_ISOLATION_ID} db=${isolation.WORKSPACEX_DB} ` +
    `compose=${isolation.COMPOSE_PROJECT_NAME} pg=${isolation.PGPORT} redis=${isolation.REDIS_PORT}`,
  );
  const result = await new Promise<{ code: number | null; error: Error | null }>((resolve) => {
    child.once("error", (error) => resolve({ code: null, error }));
    child.once("exit", (code) => resolve({ code, error: null }));
  });
  const cleanupError = cleanup();
  if (cleanupError) console.error(`[test-isolation] cleanup failed: ${cleanupError}`);
  if (result.error) {
    console.error(`[test-isolation] failed to start ${command[0]}: ${result.error.message}`);
    process.exit(1);
  }
  if (receivedSignal) {
    const signalExit = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }[receivedSignal];
    process.exit(signalExit);
  }
  if (result.code !== 0) process.exit(result.code ?? 1);
  process.exit(cleanupError ? 1 : 0);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
