#!/usr/bin/env node
/**
 * verify:full 的两条 lane 编排器（#3094）。
 *
 * 旧形态是 `verify:base:raw && verify:fullstack-smoke:raw`：单测 lane 一红，
 * 浏览器 e2e lane **永远不执行**，而 job 级 `failure` 读起来像「e2e 跑了且失败」。
 * 2026-09-08 实测（run 34210666232）：一条已知红的 api 单测（#2995）把 C3 / E2
 * 两条 chat 路径整个挡在门外，日志里唯一提到它们的却是覆盖清单 lint 的静态注册行。
 *
 * 这里把两条 lane 解耦：**每条都跑**，各自结果分别写进日志与产物；
 * 任一条红 ⇒ 整体非零退出（不吞红——`|| true` 是被明确禁止的修法）。
 *
 * lane 之间没有数据依赖：`verify:base:raw` 是 lint/typecheck/单测，
 * `verify:fullstack-smoke:raw` 自己起真栈、不消费前者产物。串行只是为了不抢
 * 机器资源，不是因为后者需要前者成功。
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface LaneSpec {
  /** 稳定标识，进产物 JSON */
  id: string;
  /** 人读名字，进日志 */
  label: string;
  /** pnpm script 名 */
  script: string;
}

/**
 * `not-run` 是本次修复的核心词汇：它把「没跑」和「跑了且失败」在日志与产物里
 * 分开。正常路径下不会出现——两条 lane 都必然被执行——它只在编排器自己出事
 * （lane 启动抛异常）时兜底，确保那一趟留下的记录是「未执行」而不是沉默。
 */
export type LaneOutcome = "passed" | "failed" | "not-run";

export interface LaneResult {
  id: string;
  label: string;
  script: string;
  outcome: LaneOutcome;
  /** `not-run` 时为 null——没有退出码可言，别拿 0/1 冒充。 */
  exitCode: number | null;
  /** 仅 `not-run`：为什么没跑。 */
  notRunReason?: string;
}

export const LANES: LaneSpec[] = [
  { id: "base", label: "单测/lint/typecheck (verify:base:raw)", script: "verify:base:raw" },
  {
    id: "browser-e2e",
    label: "浏览器 e2e (verify:fullstack-smoke:raw)",
    script: "verify:fullstack-smoke:raw",
  },
];

export type LaneRunner = (lane: LaneSpec) => number;

const productionRunner: LaneRunner = (lane) => {
  const child = spawnSync("pnpm", ["run", lane.script], { stdio: "inherit" });
  if (child.error) {
    console.error(`  lane 启动失败：${child.error.message}`);
    return 1;
  }
  if (typeof child.status === "number") return child.status;
  // 被信号杀死（如 SIGTERM）：没有退出码，按失败计。
  return 1;
};

export function runLanes(
  lanes: LaneSpec[] = LANES,
  runLane: LaneRunner = productionRunner,
  log: (line: string) => void = (line) => console.log(line),
): { results: LaneResult[]; exitCode: number } {
  const results: LaneResult[] = [];
  let abortReason: string | null = null;

  for (const lane of lanes) {
    if (abortReason !== null) {
      results.push({
        id: lane.id,
        label: lane.label,
        script: lane.script,
        outcome: "not-run",
        exitCode: null,
        notRunReason: abortReason,
      });
      log(`⏭ lane 未执行：${lane.label} —— ${abortReason}`);
      continue;
    }

    log(`\n▶ lane 开始：${lane.label}`);
    let exitCode: number;
    try {
      exitCode = runLane(lane);
    } catch (error) {
      abortReason = `编排器无法拉起该 lane：${(error as Error).message}`;
      results.push({
        id: lane.id,
        label: lane.label,
        script: lane.script,
        outcome: "not-run",
        exitCode: null,
        notRunReason: abortReason,
      });
      log(`⏭ lane 未执行：${lane.label} —— ${abortReason}`);
      continue;
    }
    const outcome: LaneOutcome = exitCode === 0 ? "passed" : "failed";
    results.push({ id: lane.id, label: lane.label, script: lane.script, outcome, exitCode });
    log(
      outcome === "passed"
        ? `✅ lane 通过：${lane.label}`
        : `❌ lane 失败：${lane.label}（退出码 ${exitCode}）—— 后续 lane 仍会执行`,
    );
  }

  log("\n=== verify:full lane 结果汇总 ===");
  const mark = { passed: "✅ 已执行并通过", failed: "❌ 已执行并失败", "not-run": "⏭ 未执行" };
  for (const r of results) {
    log(`  ${mark[r.outcome]}  ${r.label}${r.notRunReason ? `（${r.notRunReason}）` : ""}`);
  }

  const failed = results.filter((r) => r.outcome !== "passed");
  if (failed.length > 0) {
    log(
      `\n✗ verify:full 未全绿的 lane：${failed
        .map((r) => `${r.id}(${r.outcome === "failed" ? "已执行并失败" : "未执行"})`)
        .join(", ")}`,
    );
  } else {
    log("\n✅ verify:full 两条 lane 均执行并通过");
  }
  return { results, exitCode: failed.length > 0 ? 1 : 0 };
}

export function summaryArtifact(results: LaneResult[]): string {
  return `${JSON.stringify({ generatedAt: new Date().toISOString(), lanes: results }, null, 2)}\n`;
}

function main(): void {
  const { results, exitCode } = runLanes();
  const outFile = path.resolve(process.cwd(), "evidence", "verify-full-lanes.json");
  try {
    mkdirSync(path.dirname(outFile), { recursive: true });
    writeFileSync(outFile, summaryArtifact(results));
    console.log(`\n产物：${outFile}`);
  } catch (error) {
    console.error(`(写 lane 汇总产物失败，不影响判定) ${(error as Error).message}`);
  }
  process.exit(exitCode);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
