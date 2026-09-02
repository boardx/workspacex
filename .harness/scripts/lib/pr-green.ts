// pr-green.ts — 完成定义第 7 条「关闭 issue 的 PR 合入时 CI 全绿」的纯判定（#2539 / #2540）。
//
// 规则来自人类 2026-09-02 指令：解决 issue 必须开 PR，且跟进到 PR 绿了才算完。
// 「绿」不在这里另定义——check 的语义（哪些是必需、红/空转/未出结论各算什么）全部复用
// lib/pr-queue.ts 的 classifyChecks，那是合并门的唯一事实源；本文件只回答
// 「这个 issue 关闭时，关掉它的那个 PR 按同一套语义是不是绿的」。
//
// 不倒查存量：规则生效前关闭的 issue 一律 not-applicable（同 spec_ref 门对历史 feature
// 的处理；引入门控当天把所有 PR 打红只会让门被绕过，#848 / #2485 的教训）。
import { classifyChecks, type RequiredCheck } from "./pr-queue";

/** 第 7 条生效时刻 = 规则 PR（#2541）开出的时刻。此前关闭的 issue 不判。 */
export const PR_GREEN_RULE_EFFECTIVE_FROM = "2026-09-02T17:40:00Z";

export interface ClosingPr {
  number: number;
  merged: boolean;
  headSha: string;
  /** 合入时 head 上的全部 check（缺席 ≠ 通过，同 classifyPr） */
  checks: RequiredCheck[];
}

export type PrGreenVerdict =
  | { kind: "not-applicable"; reason: string }
  | { kind: "ok"; pr: number }
  | { kind: "violation"; reasons: string[] };

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
    const gaps = classifyChecks(pr.checks);
    for (const r of [...gaps.blocked, ...gaps.changes, ...gaps.waitingCi]) reasons.push(`PR #${pr.number}@${pr.headSha.slice(0, 8)}：${r}`);
  }
  if (reasons.length > 0) return { kind: "violation", reasons };
  return { kind: "ok", pr: merged[0]!.number };
}
