#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ensureReservedTestIsolation } from "./lib/test-isolation";
import { acquireStackSlot, type AcquireOptions, type StackSlot } from "./lib/stack-admission";
import { Stopwatch, printReport, recordRun } from "./lib/verify-timing";

export interface TestIsolationRuntime {
  acquireSlot: (options: AcquireOptions) => Promise<StackSlot>;
}

const productionRuntime: TestIsolationRuntime = {
  acquireSlot: acquireStackSlot,
};

export async function runWithTestIsolation(
  argv: string[],
  runtime: TestIsolationRuntime = productionRuntime,
): Promise<number> {
  const separator = argv.indexOf("--");
  const command = separator >= 0 ? argv.slice(separator + 1) : argv.slice(2);
  if (command.length === 0) {
    console.error("usage: with-test-isolation -- <command> [args...]");
    return 2;
  }

  // 耗时统计（ADR-106 batch-1/6，#1278）：本文件能直接观察四段——环境预留 / 等待
  // 资源（stack-admission 排队）/ 命令执行（内层命令整体墙钟）/ 清理。四段之和会
  // 略小于总计（脚本自身启动开销、Promise 调度间隙未计入任何命名阶段），但足以
  // 交叉核对报告有没有漏掉一大块时间——上一版只测两段时，实测跑一次 `true` 命令
  // 总计 135ms、两段之和却只有 4ms，131ms 不知去向；这版补上环境预留/清理两段后
  // 差值应该收窄到个位数毫秒（dogfood 见 commit message）。内层命令自己的子阶段
  // （19 个 lint doctor 各多久、turbo typecheck 多久）仍是黑盒，没拆，见
  // lib/verify-timing.ts 顶部说明，这里不重复。
  const timing = new Stopwatch();

  // #468：端口不再靠哈希猜，而是真的向 OS 预留（探到即持有），起栈前才释放。
  timing.start("环境预留");
  const reservation = await ensureReservedTestIsolation(process.env);
  timing.stop();
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
      return 2;
    }
    console.log(message);
  }

  // 并行度准入：起栈前排队，不是拒绝。机器 2026-08-05 曾到 4.08 倍超额认购
  // （load 40.78 / 10 核），`docker ps` 超时 >2min，连 `uptime` 都 300 秒没返回。
  // 拒绝会让 agent 以为自己写错了——今天就有人把饥饿归因成自己的代码。
  timing.start("等待资源");
  const slot = await runtime.acquireSlot({
    repoRoot: fileURLToPath(new URL("../..", import.meta.url)),
    isolationId: isolation.WORKSPACEX_ISOLATION_ID,
  });
  timing.stop();

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
  timing.start("命令执行");
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
  timing.stop();
  timing.start("清理");
  const cleanupError = cleanup();
  timing.stop();
  slot.release();

  const run = timing.finish(command.join(" "), isolation.WORKSPACEX_ISOLATION_ID);
  printReport(run);
  recordRun(run);
  // 预算值本次不内置默认：拍脑袋定的预算比没有预算更容易被当真——先攒够几轮
  // 真实数据（读 lib/verify-timing.ts 的 readAllRuns + computeStats）再定基线，
  // checkBudget() 已经可用，调用方自己决定要不要传预算表。

  if (cleanupError) console.error(`[test-isolation] cleanup failed: ${cleanupError}`);
  if (result.error) {
    console.error(`[test-isolation] failed to start ${command[0]}: ${result.error.message}`);
    return 1;
  }
  if (receivedSignal) {
    const signalExit = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }[receivedSignal];
    return signalExit;
  }
  if (result.code !== 0) return result.code ?? 1;
  return cleanupError ? 1 : 0;
}

function isMainModule(): boolean {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  void runWithTestIsolation(process.argv).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
