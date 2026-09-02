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
// push workflow 也会往同一个 commit 上加 check。直接把 head 上现在的全部 run 喂给
// classifyChecks，会出现两种错：合入前失败、合入前 rerun 成功的 PR **永远违反**
// （旧 FAILURE 一直在）；合入时绿、合入后被别的 run 打红的 PR **事后变违反**。
// 修法：每条 run 带 startedAt，只取 startedAt ≤ mergedAt 的（合入后的 run 一律无关），
// 同名取 startedAt 最晚的一条（rerun 覆盖前一次）。run 记录本身不会被删，时间戳不可变，
// 所以这份重建是稳定的（独立审对 PR #2541 的意见 1/2）。
//
// 不倒查存量：规则生效前关闭的 issue 一律 not-applicable（同 spec_ref 门对历史 feature
// 的处理；引入门控当天把所有 PR 打红只会让门被绕过，#848 / #2485 的教训）。
import { classifyChecks, type RequiredCheck } from "./pr-queue";

/** 第 7 条生效时刻 = 规则 PR（#2541）开出的时刻。此前关闭的 issue 不判。 */
export const PR_GREEN_RULE_EFFECTIVE_FROM = "2026-09-02T17:40:00Z";

/** 一条 check run 的原始观测（REST `check-runs?filter=all` 的一行）。 */
export interface CheckRunObservation extends RequiredCheck {
  /** ISO；缺失视为无法定位时刻，保守当作「合入前」参与判定 */
  startedAt: string | null;
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

/**
 * 重建「合入那一刻」的 check 集合：只取 startedAt ≤ mergedAt 的 run，同名保留 startedAt
 * 最晚的一条。返回的形状与 pr-queue 的 PrFacts.checks 一致，直接喂 classifyChecks。
 */
export function reconstructMergeTimeChecks(runs: CheckRunObservation[], mergedAt: string): RequiredCheck[] {
  const merged = Date.parse(mergedAt);
  const latest = new Map<string, CheckRunObservation>();
  for (const run of runs) {
    const started = run.startedAt ? Date.parse(run.startedAt) : Number.NEGATIVE_INFINITY;
    if (started > merged) continue; // 合入之后才开始的 run 与「合入时是否绿」无关
    const prev = latest.get(run.name);
    const prevStarted = prev?.startedAt ? Date.parse(prev.startedAt) : Number.NEGATIVE_INFINITY;
    if (!prev || started >= prevStarted) latest.set(run.name, run);
  }
  return [...latest.values()].map(({ name, status, conclusion }) => ({ name, status, conclusion }));
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
