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
//   · 合入时还没跑完、合入后才 SUCCESS 的 run 被当成「合入时绿」——**确定性的假绿**。
// 修法：每条 run 带 startedAt / completedAt（和 id），按下面的规则重建。run 记录本身不会被删，
// 时间戳不可变，所以这份重建是稳定的，不需要另存快照。
//
// ## 重建规则（reconstructMergeTimeChecks）——对齐 GitHub rollup / pr-queue 看到的「当前 attempt」
//   · 合入之后才开始的 run 与「合入时是否绿」无关，丢弃；
//   · 同名 run 里，取**合入时刻已开始的最新一次 attempt**（按 startedAt 排序，同一时刻按 id），
//     它就是合入那一刻 GitHub 侧展示、pr-queue 会拿到的那一条——不管它当时跑完没有；
//   · 对选中的这条：completedAt ≤ mergedAt ⇒ 用它的终态结论；否则（未完成 / 合入后才完成）⇒
//     它在合入时刻是「未出结论」（status IN_PROGRESS、conclusion null）。**绝不**因为最新 attempt
//     还在跑就退回去用更早一次的 SUCCESS——合入时 GitHub 显示的是 pending，pr-queue 会判
//     WAITING_CI，「带着未跑完的必需 check 合入」不算绿（独立审对 PR #2541 第四轮意见）。
//
// 不倒查存量：规则生效前关闭的 issue 一律 not-applicable（同 spec_ref 门对历史 feature
// 的处理；引入门控当天把所有 PR 打红只会让门被绕过，#848 / #2485 的教训）。
import { classifyChecks, statusContextToCheck, type RequiredCheck } from "./pr-queue";

/** 第 7 条生效时刻 = 规则 PR（#2541）开出的时刻。此前关闭的 issue 不判。 */
export const PR_GREEN_RULE_EFFECTIVE_FROM = "2026-09-02T17:40:00Z";

/** 一条 check run 的原始观测（REST `check-runs?filter=all` 的一行）。 */
export interface CheckRunObservation extends RequiredCheck {
  /** check run id，单调递增；同一 startedAt 时用它定先后 */
  id?: number;
  /** ISO；缺失视为无法定位开始时刻，保守当作「合入前开始」 */
  startedAt: string | null;
  /** ISO；null = 观测时仍未完成（非终态） */
  completedAt: string | null;
}

/** 一条 commit status 的原始观测（REST `commits/{sha}/statuses` 的一行）。每次 POST 都是一条新记录，不覆盖旧的。 */
export interface CommitStatusObservation {
  id?: number;
  context: string;
  state: string | null;
  /** ISO：这条 state 被打上的时刻 */
  createdAt: string | null;
}

/**
 * commit status → 与 check run 同形的观测，喂同一套 reconstructMergeTimeChecks。
 * status 没有「开始 / 完成」，它是一次**瞬时**观测：createdAt 既是开始也是完成，
 * 合入时刻取的是「合入前最后一次打上的 state」，合入后打的与合入时无关——与 check run 同规则。
 * state → RequiredCheck 的映射复用 pr-queue 的 statusContextToCheck（活 rollup 同一处），不另写。
 */
export function commitStatusToObservation(s: CommitStatusObservation): CheckRunObservation {
  return { id: s.id, ...statusContextToCheck(s.context, s.state), startedAt: s.createdAt, completedAt: s.createdAt };
}

export interface ClosingPr {
  number: number;
  merged: boolean;
  /** ISO；merged 为 true 时必须有，否则无法重建合入时刻 */
  mergedAt: string | null;
  headSha: string;
  /** head 上的**全部**观测：check run（含 rerun 与合入后追加的）+ commit status（经 commitStatusToObservation），
   *  由 reconstructMergeTimeChecks 筛。GitHub rollup 混着 CheckRun 与 StatusContext 两种，只重建其一就是漏看红。 */
  runs: CheckRunObservation[];
}

function ts(iso: string | null): number | null {
  if (!iso) return null;
  const n = Date.parse(iso);
  return Number.isNaN(n) ? null : n;
}

/** attempt 的先后：startedAt 晚的新；同一时刻 id 大的新。 */
function isNewer(a: CheckRunObservation, b: CheckRunObservation): boolean {
  const sa = ts(a.startedAt) ?? Number.NEGATIVE_INFINITY;
  const sb = ts(b.startedAt) ?? Number.NEGATIVE_INFINITY;
  if (sa !== sb) return sa > sb;
  return (a.id ?? 0) > (b.id ?? 0);
}

/**
 * 重建「合入那一刻」的 check 集合（规则见文件头）。返回形状与 pr-queue 的 PrFacts.checks
 * 一致，直接喂 classifyChecks。
 */
export function reconstructMergeTimeChecks(runs: CheckRunObservation[], mergedAt: string): RequiredCheck[] {
  const merged = Date.parse(mergedAt);
  /** 每个名字在合入时刻已开始的最新一次 attempt */
  const current = new Map<string, CheckRunObservation>();
  for (const run of runs) {
    const started = ts(run.startedAt) ?? Number.NEGATIVE_INFINITY;
    if (started > merged) continue; // 合入之后才开始的 run 无关
    const prev = current.get(run.name);
    if (!prev || isNewer(run, prev)) current.set(run.name, run);
  }
  const out: RequiredCheck[] = [];
  for (const [name, run] of current) {
    const completed = ts(run.completedAt);
    if (completed !== null && completed <= merged) {
      out.push({ name, status: run.status, conclusion: run.conclusion });
    } else {
      // 合入时这条 attempt 还在跑：不携带结论。不退回更早一次的结果——那不是合入时 GitHub 显示的状态。
      out.push({ name, status: "IN_PROGRESS", conclusion: null });
    }
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
