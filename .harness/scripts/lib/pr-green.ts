// pr-green.ts — 完成定义第 7 条「关闭 issue 的 PR 合入时 CI 全绿」的纯判定（#2539）。
//
// 规则来自人类 2026-09-02 指令：解决 issue 必须开 PR，且跟进到 PR 绿了才算完。
// 「绿」不在这里另定义——check 的语义（哪些是必需、红/空转/未出结论各算什么）全部复用
// lib/pr-queue.ts 的 classifyChecks，那是合并门的唯一事实源；本文件只回答两件事：
//   1. 「合入时」的 check 集合是什么（reconstructMergeTimeChecks）；
//   2. 这个 issue 关闭时，关掉它的那个 PR 按同一套语义是不是绿的（judgeClosingPrGreen）。
//
// ## 为什么要「重建合入时刻」而不是直接读 head 上现在的 check
//
// check run 是可变的历史观测：合入后有人 rerun 会在同一个 head 上追加新 run；main 的
// push workflow 也会往同一个 commit 上加 check；一条合入时还在跑的 run，事后看到的是它
// 最终的 SUCCESS。直接把 head 上现在的 run 喂给 classifyChecks 会出三种错：
//   · 合入前失败、合入前 rerun 成功的 PR **永远违反**（旧 FAILURE 一直在）；
//   · 合入时绿、合入后被别的 run 打红的 PR **事后变违反**；
//   · 合入时还没跑完、合入后才 SUCCESS 的 run 被当成「合入时绿」——**确定性的假绿**
//     （独立审对 PR #2541 的第三轮意见）。
// 修法：每条 run 带 startedAt / completedAt，按下面的规则重建。run 记录本身不会被删，
// 时间戳不可变，所以这份重建是稳定的，不需要另存快照。
//
// ## 重建规则（reconstructMergeTimeChecks）
//   · 合入之后才开始的 run 与「合入时是否绿」无关，丢弃；
//   · 只有在 mergedAt 之前**完成**的 run 才携带合入时刻的结论；同名取 completedAt 最晚的一条
//     （合入前的 rerun 覆盖前一次）；
//   · 合入前开始、但到 mergedAt 还没完成（completedAt 为空或晚于 mergedAt）的 run，**不携带结论**，
//     也**不覆盖**同名更早已完成的结论；若某个名字只有这类 run，它在合入时刻就是「未出结论」
//     （status IN_PROGRESS、conclusion null）——required 的话 classifyChecks 会判 WAITING_CI，
//     即「带着未跑完的必需 check 合入」不算绿。
//
// 不倒查存量：规则生效前关闭的 issue 一律 not-applicable（同 spec_ref 门对历史 feature
// 的处理；引入门控当天把所有 PR 打红只会让门被绕过，#848 / #2485 的教训）。
import { classifyChecks, type RequiredCheck } from "./pr-queue";

/** 第 7 条生效时刻 = 规则 PR（#2541）开出的时刻。此前关闭的 issue 不判。 */
export const PR_GREEN_RULE_EFFECTIVE_FROM = "2026-09-02T17:40:00Z";

/** 一条 check run 的原始观测（REST `check-runs?filter=all` 的一行）。 */
export interface CheckRunObservation extends RequiredCheck {
  /** ISO；缺失视为无法定位开始时刻，保守当作「合入前开始」 */
  startedAt: string | null;
  /** ISO；null = 观测时仍未完成（非终态） */
  completedAt: string | null;
}

export interface ClosingPr {
  number: number;
  merged: boolean;
  /** ISO；merged 为 true 时必须有，否则无法重建合入时刻 */
  mergedAt: string | null;
  headSha: string;
  /** head 上的**全部** run（含 rerun 与合入后追加的），由 reconstructMergeTimeChecks 筛 */
  runs: CheckRunObservation[];
}

function ts(iso: string | null): number | null {
  if (!iso) return null;
  const n = Date.parse(iso);
  return Number.isNaN(n) ? null : n;
}

/**
 * 重建「合入那一刻」的 check 集合（规则见文件头）。返回形状与 pr-queue 的 PrFacts.checks
 * 一致，直接喂 classifyChecks。
 */
export function reconstructMergeTimeChecks(runs: CheckRunObservation[], mergedAt: string): RequiredCheck[] {
  const merged = Date.parse(mergedAt);
  /** 每个名字在合入前最后一次**完成**的 run */
  const concluded = new Map<string, { run: CheckRunObservation; completed: number }>();
  /** 合入前开始、合入时尚未完成的名字（只在没有任何已完成结论时才用它表示「未出结论」） */
  const pendingAtMerge = new Set<string>();
  for (const run of runs) {
    const started = ts(run.startedAt) ?? Number.NEGATIVE_INFINITY;
    if (started > merged) continue; // 合入之后才开始的 run 无关
    const completed = ts(run.completedAt);
    if (completed === null || completed > merged) {
      pendingAtMerge.add(run.name); // 合入时还在跑：不携带结论，也不覆盖更早的结论
      continue;
    }
    const prev = concluded.get(run.name);
    if (!prev || completed >= prev.completed) concluded.set(run.name, { run, completed });
  }
  const out: RequiredCheck[] = [];
  for (const [name, { run }] of concluded) out.push({ name, status: run.status, conclusion: run.conclusion });
  for (const name of pendingAtMerge) {
    if (!concluded.has(name)) out.push({ name, status: "IN_PROGRESS", conclusion: null });
  }
  return out;
}

export type PrGreenVerdict =
  | { kind: "not-applicable"; reason: string }
  | { kind: "ok"; pr: number }
  | { kind: "violation"; reasons: string[] }
  /** 数据不足以重建合入时刻（例如 merged 却没有 mergedAt）——调用方按 strict 级别处理，不当绿 */
  | { kind: "unknown"; reason: string };

export function judgeClosingPrGreen(input: {
  issueNumber: number;
  issueClosedAt: string | null | undefined;
  closingPrs: ClosingPr[];
  effectiveFrom?: string;
}): PrGreenVerdict {
  const cutoff = Date.parse(input.effectiveFrom ?? PR_GREEN_RULE_EFFECTIVE_FROM);
  const closedAt = input.issueClosedAt ? Date.parse(input.issueClosedAt) : NaN;
  if (Number.isNaN(closedAt)) return { kind: "not-applicable", reason: "issue 没有 closedAt（未关闭或字段缺失）" };
  if (closedAt < cutoff) return { kind: "not-applicable", reason: `issue 于 ${input.issueClosedAt} 关闭，早于第 7 条生效时刻 ${PR_GREEN_RULE_EFFECTIVE_FROM}，不倒查` };

  const merged = input.closingPrs.filter((pr) => pr.merged);
  if (merged.length === 0) {
    return {
      kind: "violation",
      reasons: [`issue #${input.issueNumber} 已关闭，但没有任何已合入的 PR 关闭它——「不许没有 PR 就关 issue」`],
    };
  }
  const reasons: string[] = [];
  for (const pr of merged) {
    if (!pr.mergedAt || Number.isNaN(Date.parse(pr.mergedAt))) {
      return { kind: "unknown", reason: `PR #${pr.number} 标记为已合入却没有 mergedAt，无法重建合入时刻的 check` };
    }
    const gaps = classifyChecks(reconstructMergeTimeChecks(pr.runs, pr.mergedAt));
    for (const r of [...gaps.blocked, ...gaps.changes, ...gaps.waitingCi]) reasons.push(`PR #${pr.number}@${pr.headSha.slice(0, 8)}（合入于 ${pr.mergedAt}）：${r}`);
  }
  if (reasons.length > 0) return { kind: "violation", reasons };
  return { kind: "ok", pr: merged[0]!.number };
}
