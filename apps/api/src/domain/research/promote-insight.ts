/**
 * F147 —— 结论入洞察库的三道门槛 + 决策节点回流的部分成功
 * （`research` 束 domain.md N-1 / N-2 / N-5 / N-11，`uc-24-4` R3 / R7.1–R7.4 / A1 / E1–E5 / R12.1–7，
 * `packages/contracts/src/research.ts` `promoteConclusionToInsight` 注释逐字）。
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74：本地不跑任何需要 Postgres 的测试）。
 *
 * ## 这个文件必须立住的四条不变量
 *
 * 1. **三道门槛必须分开报错**（N-1 / N-2 / N-5 ⇒ `NO_EXTERNAL_SOURCE` /
 *    `EVIDENCE_IS_DISPUTED` / `CONFLICT_PENDING_HUMAN`）。它们对应三条不同的
 *    补救路径（补来源 / 改判定——不由本域实现 / 等人判），合并成一个
 *    `PROMOTE_BLOCKED` 会让用户走错路——这条禁令直接来自契约注释。
 * 2. **门槛只挡"缺什么"，不挡"值多低"**（R7.3）。低置信证据（例：0.3）
 *    **不触发** `NO_EXTERNAL_SOURCE`——它是"标出"不是"丢弃"，且随候选洞察
 *    一起带过去、保持置信度可读（R12.3）。
 * 3. **`DECISION_NODE_GONE` 只出现在 `out.nodeBackflow.reason`，绝不出现在
 *    任何 `err` 里**（E2）。入库已经发生，把它放进 `err` 会让前端读到失败、
 *    回滚一次已经成功的入库——这是契约注释点名"最容易做错的一条"。
 * 4. **`nodeBackflow` 是三态，不是布尔**：`attempted:false`（A1，配置里就没挂
 *    节点，合法路径不是降级）/ `attempted:true, ok:true`（回流成功）/
 *    `attempted:true, ok:false, reason:"DECISION_NODE_GONE"`（E2）。
 *
 * ## 本文件刻意没有的东西
 * · **重复入库的语义**（Q-15 未裁）——不实现幂等 / 报错 / 新建任一种。
 * · **候选洞察 / 回流记录的持久化**——`persistInsight` / `persistBackflow` 由
 *   调用方注入，本文件只管三道门槛与三态回流这两处纯计算。
 * · **id 生成**——`buildCandidateInsight` 的 `id` 由调用方传入（同
 *   `archive.ts` 的 `archivedAt` 处理方式：时间戳/id 生成不是纯逻辑该管的事）。
 */
import { research } from "@repo/contracts";
import type { z } from "zod";

export type EvidenceT = z.infer<typeof research.Evidence>;
export type CandidateInsightT = z.infer<typeof research.CandidateInsight>;
export type ResearchConflictT = z.infer<typeof research.ResearchConflict>;

type PromoteOutT = z.infer<
  (typeof research.operations.promoteConclusionToInsight)["out"]
>;
export type NodeBackflowT = PromoteOutT["nodeBackflow"];

/** 本操作三道门槛各自对应的失败码（`err` 面的子集，与 `DECISION_NODE_GONE` 严格不相交）。 */
export type PromoteGateFailure = "NO_EXTERNAL_SOURCE" | "EVIDENCE_IS_DISPUTED" | "CONFLICT_PENDING_HUMAN";

/**
 * **值域未定**（Q-10 同族）：原型给出的两串候选洞察状态文案。
 * ⚠ 本文件不裁哪个语境用哪个——由调用方经 `candidateStatus` 参数指定，
 *   这里只保证"两串之一"这条断言可机械核对（R12.9）。
 */
export const CANDIDATE_STATUS_PENDING = {
  values: ["待入定题池", "待送综合 Studio 验证"] as const,
  why: "Q-10 unruled: prototype gives two literal captions for the promoted-candidate state and never says which screen uses which",
} as const;

export type CandidateStatusT = (typeof CANDIDATE_STATUS_PENDING.values)[number];

/** 待入库的结论——只取三道门槛与回流各自需要的最小字段形状。 */
export interface ConclusionForPromotion {
  readonly id: string;
  readonly researchId: string;
  /**
   * 该结论挂着的证据。**R7.1 的判据是"非空"**：段③（"外部来源"）本身就是
   * 结论的证据并集（`result-assembly.ts` 的不变量①），本域不再发明一套
   * "内部/外部来源"二次分类——`Evidence.sourceKind` 的简称/全称映射未裁（Q-7），
   * 用它做二次分类只会引入第二份未裁的口径。
   */
  readonly evidence: readonly EvidenceT[];
  /** N-2：该结论是否落在"争议 / 不确定"段。**true ⇒ 永不入库**，无例外。 */
  readonly disputed: boolean;
  /**
   * 该结论涉及的冲突。`null` = 不涉冲突；非空且 `resolution === null` = 冲突
   * 存在但**尚未由人判定**（N-5 挡的正是这个）；`resolution` 非空 = 已判定，放行。
   */
  readonly conflict: ResearchConflictT | null;
}

/**
 * **三道门槛本身**（N-1 / N-2 / N-5），按 `usecases.md` 零节的顺序依次判定。
 *
 * ⚠ 顺序是**产品语义**不是随意选择：R7.1（缺出处）与 R7.2（争议）是结论自身
 * 的性质，天然先于"是否涉冲突"这件需要额外上下文的判定——但三者本就互斥
 * 判据不同，顺序调换不影响正确性，这里固定顺序只是让报错稳定可预测。
 */
export function evaluatePromoteGates(input: ConclusionForPromotion): PromoteGateFailure | null {
  if (input.evidence.length === 0) return "NO_EXTERNAL_SOURCE";
  if (input.disputed) return "EVIDENCE_IS_DISPUTED";
  if (input.conflict !== null && input.conflict.resolution === null) return "CONFLICT_PENDING_HUMAN";
  return null;
}

/**
 * 组装候选洞察（**N-11**：产出的是候选，不是已采信结论）。
 *
 * ⚠ **R7.3 的下游一半**：`evidence` 原样携带（含低置信条目与其数值），
 *   不做任何再过滤——过滤了就是把"标出"做成了"丢弃"。
 */
export function buildCandidateInsight(
  input: Pick<ConclusionForPromotion, "id" | "researchId" | "evidence">,
  opts: { readonly id: string; readonly candidateStatus: CandidateStatusT },
): CandidateInsightT {
  return {
    id: opts.id,
    researchId: input.researchId,
    conclusionId: input.id,
    evidence: [...input.evidence],
    candidateStatus: opts.candidateStatus,
  };
}

/**
 * 决策节点回流的输入：该研究的七项配置字段⑦-b（`decisionNodeRef`），
 * 与节点当前是否仍可达的探测结果。
 */
export interface NodeBackflowLookup {
  /** `null` = A1「不挂节点，只存进洞察库」——**合法路径，不是降级**。 */
  readonly decisionNodeRef: string | null;
  /** 仅当 `decisionNodeRef !== null` 时才有意义：节点是否仍存在且未关闭。 */
  readonly nodeExists: boolean;
}

/**
 * **三态回流结果**本身（E2 / A1 / R3.2③）。
 *
 * ⚠ 三态必须可分——`attempted:false` 与 `attempted:true, ok:false` 长得像
 *   （都不是"回流成功"），但语义天差地别：前者是用户压根没挂节点，
 *   后者是挂了但节点没了。只给一个布尔的实现会把这两件事混成一件事。
 */
export function computeNodeBackflow(lookup: NodeBackflowLookup): NodeBackflowT {
  if (lookup.decisionNodeRef === null) {
    return { attempted: false, ok: true, reason: null };
  }
  if (!lookup.nodeExists) {
    // E2：入库已经成功（本函数只在门槛通过后才被调用），回流失败必须显式记录原因。
    return { attempted: true, ok: false, reason: "DECISION_NODE_GONE" };
  }
  return { attempted: true, ok: true, reason: null };
}

/** `promoteConclusion` 的三种结局。 */
export type PromoteConclusionResult =
  | { readonly kind: "blocked"; readonly err: PromoteGateFailure }
  | { readonly kind: "promoted"; readonly insight: CandidateInsightT; readonly nodeBackflow: NodeBackflowT }
  /**
   * **E5**：下游（洞察库存储）不可用。⚠ 这不是三道门槛之一，也不是
   * `DECISION_NODE_GONE`——它发生在门槛通过**之后**、持久化那一步，且
   * **整单失败**（不是部分成功）：结论必须保持原状、可重试、不得显示已入库。
   * 本函数不吞掉持久化异常伪装成 `promoted`，这正是"禁止乐观 UI"的落点。
   */
  | { readonly kind: "persist-failed" };

/**
 * **本域最关键的编排函数**：三道门槛 → 持久化候选洞察 → 尝试节点回流。
 *
 * ⚠ 调用顺序即不变量：
 *   1. 门槛不过 ⇒ 提前返回 `blocked`，**不调用** `persistInsight`——
 *      被阻断的结论必须"入库未发生"，不是入库了又假装没发生。
 *   2. `persistInsight` 抛出 ⇒ 返回 `persist-failed`，**不再尝试节点回流**——
 *      入库本身没成功，节点回流无从谈起，且不得把这一步伪装成部分成功。
 *   3. 持久化成功后节点回流**独立计算**（`computeNodeBackflow` 是纯函数，
 *      不会抛出）——回流失败**不影响**已经持久化的候选洞察，这正是
 *      "部分成功"与"E5 整单失败"两者的分界线。
 */
export async function promoteConclusion(
  input: ConclusionForPromotion,
  node: NodeBackflowLookup,
  opts: { readonly insightId: string; readonly candidateStatus: CandidateStatusT },
  persistInsight: (insight: CandidateInsightT) => Promise<void> | void,
): Promise<PromoteConclusionResult> {
  const blocked = evaluatePromoteGates(input);
  if (blocked !== null) return { kind: "blocked", err: blocked };

  const insight = buildCandidateInsight(input, { id: opts.insightId, candidateStatus: opts.candidateStatus });

  try {
    await persistInsight(insight);
  } catch {
    return { kind: "persist-failed" };
  }

  const nodeBackflow = computeNodeBackflow(node);
  return { kind: "promoted", insight, nodeBackflow };
}
