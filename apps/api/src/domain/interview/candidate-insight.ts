/**
 * F94 —— 引述抽取后合并同类观点生成候选洞察 (`uc-6-5` R3 step 2-3, AC1,
 * `packages/contracts/src/interview.ts` `Insight`/`generateCandidateInsights`/`confirmInsight`).
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74：本地不跑任何需要 Postgres 的测试）。
 *
 * ## 这个文件必须立住的两条不变量
 *
 * 1. **候选必须带可追溯来源，来源不足不得伪造结论**（R3 step2/3）——`buildCandidateInsight`
 *    对空引述列表直接拒绝（`INSIGHT_NO_EVIDENCE`），不产出"没有来源却存在"的候选；
 *    `checkConfirmable` 是 `confirmInsight` 复用的同一道门，缺来源的候选**不可被确认**
 *    （R3 step3 原文），不是两处各自判一次。
 * 2. **候选一律不是「已标强」**——`strong` 恒为 `false`。标强是 `markStrongInsight`
 *    单独一个人的确认动作（且只有真人来源能标，I-28），候选生成这一步不能替它
 *    抢答，否则"标强"就不再是一个需要人复核的显式动作。
 *
 * ## 本文件刻意没有的东西
 * · **合并同类观点的语义算法**（哪些引述算"同一个观点"）——那是模型/检索侧的事，
 *   本文件只管"给定一组已经被判定属于同一候选的引述，怎么把它们组装/门控成
 *   一条 `Insight`"，同 `promote-insight.ts` 对"三道门槛"与"结论组装"的切法一致。
 * · **`context_packs`/Context API 的调用与留痕**（`domain.md` [设计]「只能通过
 *   Context API 取 Context Pack」）——那是编排层的职责，本文件不连任何存储。
 * · **`Insight.sourceKind` 混合来源的裁决**——契约 `KNOWN_CONTRACT_GAPS.C_ITV_6`
 *   已经标出这是本束的猜测而非 UC 明文；本文件延用同一个保守默认（任一虚拟即整条
 *   不可标强），不重新发明第二个口径。
 */
import { interview as C } from "@repo/contracts";
import type { z } from "zod";

export type InsightT = z.infer<typeof C.Insight>;
export type InterviewSourceKindT = z.infer<typeof C.InterviewSourceKind>;

/** 组装候选洞察所需的最小引述形状。 */
export interface QuoteForCandidate {
  readonly quoteId: string;
  readonly sourceKind: InterviewSourceKindT;
}

export type BuildCandidateResult =
  | { readonly ok: true; readonly candidate: InsightT }
  | { readonly ok: false; readonly reason: "INSIGHT_NO_EVIDENCE" };

/**
 * buildCandidateInsight —— 组装一条候选洞察（R3 step2）。
 *
 * ⚠ 空引述列表 ⇒ `INSIGHT_NO_EVIDENCE`，**不产出**任何候选——"来源不足时不得伪造
 *   结论" 逐字要求这一步就是入口，不是留到 confirm 才拦。
 * ⚠ `sourceKind`：任一引述来自虚拟来源即整条候选标 `virtual`（C_ITV_6 的保守默认），
 *   使下游 `markStrongInsight`/`referenceForDecision` 的虚拟隔离对混合来源候选同样生效。
 */
export function buildCandidateInsight(
  input: { readonly text: string; readonly quotes: readonly QuoteForCandidate[] },
  opts: { readonly insightId: string },
): BuildCandidateResult {
  if (input.quotes.length === 0) return { ok: false, reason: "INSIGHT_NO_EVIDENCE" };

  const sourceKind: InterviewSourceKindT = input.quotes.every((q) => q.sourceKind === "human")
    ? "human"
    : "virtual";

  return {
    ok: true,
    candidate: {
      insightId: opts.insightId,
      text: input.text,
      sourceKind,
      // 候选恒不标强：标强是 markStrongInsight 单独的人工确认动作，见文件头注释②。
      strong: false,
      evidenceQuoteIds: input.quotes.map((q) => q.quoteId),
      // 候选阶段尚未入库，来源快照只在 confirmInsight 入库时固化（R3 step9 / D-30）。
      pinnedSourceSnapshotId: null,
    },
  };
}

export type ConfirmGateResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "INSIGHT_NO_EVIDENCE" };

/**
 * checkConfirmable —— confirmInsight 复用的同一道"缺来源不可确认"门（R3 step3）。
 *
 * ⚠ 与 `buildCandidateInsight` 的空引述拒绝是**同一条规则的两个必经检查点**，不是
 *   偶然重复：生成时应该已经挡掉了，但确认时的候选可能来自客户端直传的编辑态
 *   （契约 `confirmInsight.in.edits`），所以这里必须再次核对，而不是信任"生成时
 *   已经查过了"。
 */
export function checkConfirmable(
  candidate: Pick<InsightT, "evidenceQuoteIds">,
): ConfirmGateResult {
  return candidate.evidenceQuoteIds.length === 0
    ? { ok: false, reason: "INSIGHT_NO_EVIDENCE" }
    : { ok: true };
}
