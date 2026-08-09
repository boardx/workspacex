/**
 * core-loop-readiness-doctor.ts —— `pnpm harness readiness`，issue #814。
 *
 * 派生视图 + 体检，两件事一个入口（同 `pr-queue` 的做法：只读、给结论、不改状态）。
 *
 * ## 为什么 git 查询在这里而不在 lib 里
 *
 * `lib/core-loop-readiness.ts` 是纯函数，判定逻辑要能在单测里被穷举；I/O 不能。
 * 所以"这条 track 评分之后 watch 路径有没有改过"由本文件用 `git diff --name-only`
 * 查出来，作为 `changedSince` 喂给纯函数。这与 `pr-queue.ts` 把 GitHub 查询留在
 * 外面是同一条分界。
 *
 * ## `--strict` 的语义
 *
 * 缺省只渲染看板（人看的），不影响退出码——每天看一眼不该因为分数低就把 CI 打红，
 * 分数低是**事实**不是**故障**。`--strict`（doctor / CI 用）只对**结构问题**退非 0：
 * 记录形状不合法、评分人越权、有分数却没有 SHA。这条区分很重要：
 *
 *   · CLR = 0 是事实 ⇒ 不红（红了就会有人为了让 CI 绿而去改分数，那正是要防的）
 *   · 记录本身自相矛盾 ⇒ 红（它让 CLR 这个数字失去意义）
 *
 * ## 队列里的死条目也算"自相矛盾"（#823 的直接产物）
 *
 * 2026-08-09 当天，`blocking_issues` 里挂着 #627/#552 两个**早已关闭、修复早已合并**
 * 的 issue，而它们是我照着 `core-loop.spec.ts` 的过期注释播下去的。后果不是"多两行
 * 噪音"：统一队列是**所有 agent 的唯一取活口**，带死条目意味着有人会去做一件已经做完
 * 的事，或者——实际发生的——评分员照着这份清单把早已修好的维度打成 0 分。
 *
 * 所以 `--strict` 多查一件事：**队列里出现已 CLOSED 的 issue 当场判红**。
 * 这道门很窄（只查 `blocking_issues`，不查散文），但零误报、且正好卡住那个真实事故点。
 * 它防不住 issue 正文/代码注释里的过期断言——那类需要人读，见 #823 写进标准的纪律。
 *
 * ⚠ 查 issue 状态要联网（`gh`）。拿不到结果时**跳过这道门并明说**，不判红——
 * 把"问不到"当成"有问题"会让离线/无 token 环境恒红，那是空转不是门控。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Args } from "./lib/args";
import { log } from "./lib/log";
import { STATE_DIR } from "./lib/paths";
import { sh } from "./lib/sh";
import {
  judgeReadiness,
  validateState,
  type ReadinessState,
  type TrackVerdict,
} from "./lib/core-loop-readiness";

export const READINESS_PATH = join(STATE_DIR, "core-loop-readiness.json");

const DISCOUNT_TEXT: Record<string, string> = {
  NEVER_SCORED: "从未评分",
  STALE: "分数已过期（评分后 watch 路径有改动）",
  SELF_SCORED: "自评（评分人 = 实现者）",
  SCORER_NOT_ALLOWED: "评分人无此 track 的评分权",
  NO_EVIDENCE: "无证据",
  SCORE_OUT_OF_RANGE: "分数越界",
};

/** 该 track 评分之后，watch 命中的文件改了哪些。未评分则无从查起，返回 null。 */
function changedSince(sha: string | null, watch: readonly string[]): readonly string[] | null {
  if (sha === null) return null;
  const pathspec = watch.map((w) => `'${w}'`).join(" ");
  const r = sh(`git diff --name-only ${sha}..HEAD -- ${pathspec}`);
  // 查不到（SHA 不在本地、git 不可用）时返回 null 而不是空数组——"没查到"
  // 与"查了确实没改"含义不同，混淆会让 G2 静默失效。
  if (r.code !== 0) return null;
  return r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
}

export function coreLoopReadiness(args: Args): void {
  const strict = args.flags.strict === true;

  if (!existsSync(READINESS_PATH)) {
    log.err(`找不到 ${READINESS_PATH}`);
    process.exit(1);
  }
  const raw: unknown = JSON.parse(readFileSync(READINESS_PATH, "utf8"));

  const problems = validateState(raw);
  if (problems.length > 0) {
    log.err("CLR 分数记录结构不合法：");
    for (const p of problems) log.err(`  · ${p}`);
    process.exit(1);
  }
  const state = raw as ReadinessState;

  const changedByTrack: Record<string, readonly string[] | null> = {};
  for (const [id, t] of Object.entries(state.tracks)) {
    changedByTrack[id] = changedSince(t.scored_sha, t.watch);
  }

  const v = judgeReadiness(state, changedByTrack);
  const head = sh("git rev-parse HEAD").stdout.trim();

  log.step(`核心闭环就绪度 CLR = ${v.clr} / 10   （实测 HEAD: ${head.slice(0, 12)}）`);
  log.info(`   公式：min( 可达性 ${v.reachability} , 体验均值 ${v.experienceMean} )`);
  log.info(`   —— 走不到的地方做得再好也等于 0，所以可达性是天花板不是加数。`);
  log.info("");
  log.info("| track | 记录分 | 计入分 | 为什么 |");
  log.info("|---|---|---|---|");
  for (const t of v.tracks) {
    log.info(
      `| ${t.id} ${t.name} | ${t.rawScore ?? "—"} | ${t.effectiveScore} | ${fmtDiscounts(t)} |`,
    );
  }

  log.info("");
  log.step("统一队列（所有 agent 的唯一取活口，从上往下做）");
  if (v.queue.length === 0) {
    log.info("   （空——没有任何 track 声明了阻塞 issue）");
  } else {
    v.queue.forEach((issue, i) => log.info(`   ${String(i + 1).padStart(2)}. #${issue}`));
    log.info("");
    log.info("   排序规则：R（天花板）的阻塞项永远在最前——其余 track 修到满分也抬不动总分。");
  }

  // `--strict` 只对结构问题退非 0，分数低不退。理由见文件头。
  if (strict) {
    const structural = v.tracks.filter((t) =>
      t.discounts.some((d) => d === "SELF_SCORED" || d === "SCORER_NOT_ALLOWED" || d === "SCORE_OUT_OF_RANGE"),
    );
    if (structural.length > 0) {
      log.info("");
      log.err("以下 track 的分数记录自相矛盾（不是分数低，是记录本身无效）：");
      for (const t of structural) log.err(`  · ${t.id}：${fmtDiscounts(t)}`);
      process.exit(1);
    }
    const dead = findClosedQueueIssues(v.queue);
    if (dead === null) {
      log.warn("跳过「队列死条目」检查：拿不到 issue 状态（gh 不可用/未登录/离线）——问不到不等于有问题");
    } else if (dead.length > 0) {
      log.info("");
      log.err("统一队列里有已关闭的 issue —— 它会让 agent 去做已经做完的事（#823 真实事故）：");
      for (const n of dead) log.err(`  · #${n} 已 CLOSED，请从对应 track 的 blocking_issues 移除`);
      process.exit(1);
    }
    log.ok("CLR 记录结构合法（分数高低不影响本检查的退出码）");
  }
}

/**
 * 队列里哪些 issue 已经 CLOSED。返回 `null` 表示**查不到**（与"查了、没有死条目"
 * 的空数组严格区分——同 `changedSince` 对 null/[] 的处理，混淆会让门静默失效）。
 */
export function findClosedQueueIssues(queue: readonly number[]): number[] | null {
  if (queue.length === 0) return [];
  const r = sh(`gh issue list --state closed --limit 200 --json number --jq '.[].number'`);
  if (r.code !== 0) return null;
  const closed = new Set(
    r.stdout.split("\n").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0),
  );
  if (closed.size === 0) return null; // 一条都没查到，更像是查询失败而不是仓库零关闭 issue
  return queue.filter((n) => closed.has(n));
}

function fmtDiscounts(t: TrackVerdict): string {
  if (t.discounts.length === 0) return "如实计入";
  return t.discounts.map((d) => DISCOUNT_TEXT[d] ?? d).join("；");
}
