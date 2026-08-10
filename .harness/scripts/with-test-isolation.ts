#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureReservedTestIsolation } from "./lib/test-isolation";
import { acquireStackSlot } from "./lib/stack-admission";

async function main(): Promise<void> {
  const separator = process.argv.indexOf("--");
  const command = separator >= 0 ? process.argv.slice(separator + 1) : process.argv.slice(2);
  if (command.length === 0) {
    console.error("usage: with-test-isolation -- <command> [args...]");
    process.exit(2);
  }

  // #468：端口不再靠哈希猜，而是真的向 OS 预留（探到即持有），起栈前才释放。
  const reservation = await ensureReservedTestIsolation(process.env);
  const isolation = reservation.env;
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

  // 并行度准入：起栈前排队，不是拒绝。机器 2026-08-05 曾到 4.08 倍超额认购
  // （load 40.78 / 10 核），`docker ps` 超时 >2min，连 `uptime` 都 300 秒没返回。
  // 拒绝会让 agent 以为自己写错了——今天就有人把饥饿归因成自己的代码。
  const slot = await acquireStackSlot({
    repoRoot: fileURLToPath(new URL("../..", import.meta.url)),
    isolationId: isolation.WORKSPACEX_ISOLATION_ID,
  });

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

  // 占位监听必须在起栈**之前**释放，否则 docker bind 会撞上我们自己。
  await reservation.release();
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
  slot.release();
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
