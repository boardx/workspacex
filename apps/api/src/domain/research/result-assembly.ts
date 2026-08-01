/**
 * F145 —— 研究详情四段结果 + Scout 执行步骤（`research` 束 domain.md N-3 / N-8，
 * `uc-24-2` R3.4–R3.6 / R7.3 / R7.5，`usecases.md` 二节 `GetResearchDetail` 注释）。
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74：本地不跑任何需要 Postgres 的测试）。
 *   这里收进的是「组四段结果」与「组一次执行的路数统计」这两处**唯一的计算**，
 *   调用点（未来的 application 层用例）不得各自再算一遍。
 *
 * ## 这个文件必须立住的三条不变量
 *
 * 1. **N-3：低置信不得在任何层过滤。** `assembleResearchResult` 的入参没有任何
 *    `minConfidence` / `hideLowConfidence` 参数——契约面 `getResearchDetail` 本身
 *    也没有（`research.ts` 逐字注释），这里再次照做：段 ③ 恒等于**全部**证据的并集，
 *    不管置信度高低、不管所属的结论是否落进了「争议 / 不确定」。
 * 2. **R7.5：样本不足（少于 2 条独立来源）产出的是被标记的争议项，不是弱结论。**
 *    低于阈值的 claim 不进 `keyFindings`，只进 `disputed`——但它的证据仍然出现在
 *    段 ③（见上一条），这正是 uc-24-2 R3.4 「样本太少——这条我放进争议/不确定」
 *    与「低置信标出而不是丢弃」两条规则叠在同一行证据上时的正确形状。
 * 3. **E2：零 claim ⇒ 段①为空、段④是数据需求说明而不是结论。** 这里不接受调用方
 *    传入的结论文案去覆盖这一条——零来源时"没有数据不能生成真实结论"是硬规则
 *    （R7 通用硬规则），不是由上游措辞决定的。
 *
 * ⚠ **Q-7 未裁**（来源类别全称/简称映射）：`sourceKind` 在这里原样透传为
 *   `z.string()`，不发明映射——同 `packages/contracts/src/research.ts` 的
 *   `SOURCE_KIND_SHORTHAND_PENDING`。
 */
import { research } from "@repo/contracts";
import type { z } from "zod";

export type EvidenceT = z.infer<typeof research.Evidence>;
export type ResearchResultT = z.infer<typeof research.ResearchResult>;
export type ResearchRunT = z.infer<typeof research.ResearchRun>;
export type ResearchErrorT = z.infer<typeof research.ResearchError>;

/** 一条 claim（Scout 一轮里"结论层"对应的一句可判定陈述）连同它挂着的证据。 */
export interface ResearchClaimInput {
  readonly claim: string;
  readonly evidence: readonly EvidenceT[];
}

/**
 * **R7.5 的判据本身**：独立来源数 < 2（原型逐字「只找到 1 例…样本太少」）⇒
 * 这条 claim 落入「争议 / 不确定」，不产出关键发现。
 *
 * ⚠ 判据是**独立来源数**，不是证据条数——同一来源反复引用不应该把一条弱结论
 *   洗白成"多来源"。这里用 `sourceRef` 去重来逼近"独立来源"。
 */
export function isSampleTooSmall(evidence: readonly EvidenceT[]): boolean {
  const distinctSources = new Set(evidence.map((e) => e.sourceRef));
  return distinctSources.size < 2;
}

export interface AssembleResultInput {
  readonly claims: readonly ResearchClaimInput[];
  /**
   * 结论文案，由上游（Scout 的自然语言结论层）给出。
   * ⚠ `claims` 为空时本参数被**忽略**——E2 是硬规则，不由调用方的措辞决定。
   */
  readonly conclusionText: string | null;
}

/**
 * 组装研究结果四段（`ResearchResult`）。
 *
 * ⚠ 段 ③ `externalSources` 恒等于**全部** claim 的**全部**证据的并集——
 *   包括落入「争议 / 不确定」的 claim 的证据。这是 N-3 与 R7.5 同时成立的唯一形状：
 *   一条证据可以**同时**「因为样本太少而不支撑关键发现」**和**「作为低置信来源被完整列出」。
 */
export function assembleResearchResult(input: AssembleResultInput): ResearchResultT {
  const { claims, conclusionText } = input;

  if (claims.length === 0) {
    // E2：零来源。段①为空，段④是数据需求说明而不是结论——不接受调用方覆盖。
    return { keyFindings: [], disputed: [], externalSources: [], conclusion: null, isDataRequest: true };
  }

  const keyFindings: string[] = [];
  const disputed: string[] = [];
  const externalSources: EvidenceT[] = [];

  for (const c of claims) {
    // N-3：不管 claim 落在哪一段，它的证据都进段③，且不做任何置信度过滤。
    externalSources.push(...c.evidence);
    if (isSampleTooSmall(c.evidence)) {
      disputed.push(c.claim);
    } else {
      keyFindings.push(c.claim);
    }
  }

  return {
    keyFindings,
    disputed,
    externalSources,
    conclusion: conclusionText,
    isDataRequest: false,
  };
}

/** 一路检索的结果：成功（带来源类别）或失败（带失败原因）。 */
export type RouteAttempt =
  | { readonly route: number; readonly ok: true; readonly sourceKind: string }
  | { readonly route: number; readonly ok: false; readonly reason: ResearchErrorT };

export interface AssembleRunInput {
  readonly researchId: string;
  readonly runId: string;
  readonly plannedRoutes: number;
  readonly attempts: readonly RouteAttempt[];
  readonly conflictsMarked: number;
}

/**
 * 组装一次执行的 `ResearchRun`（Scout 执行步骤层：检索份数按来源类别计数 /
 * 交叉验证标为不确定的条数 / 已完成与失败的路）。
 *
 * ⚠ **E1 的可断言面**：`completedRoutes` 恒等于成功路数，`failedRoutes` 恒列出
 *   全部失败路（附原因），两者都不因为对方而被"合并成一个 success 布尔"。
 *   `plannedRoutes` 与实际尝试数无关——它来自 `depth` 档位，即便所有路都失败，
 *   调用方仍然知道"本该跑几路"（区分"3 挂 9 成"与"全挂"的前提）。
 * ⚠ 步骤①的分类计数（`sourceCounts`）**只统计成功路**——失败路没有产出可归类的来源。
 */
export function assembleResearchRun(input: AssembleRunInput): ResearchRunT {
  const { researchId, runId, plannedRoutes, attempts, conflictsMarked } = input;

  const completed = attempts.filter((a): a is Extract<RouteAttempt, { ok: true }> => a.ok);
  const failed = attempts.filter((a): a is Extract<RouteAttempt, { ok: false }> => !a.ok);

  const counts = new Map<string, number>();
  for (const a of completed) {
    counts.set(a.sourceKind, (counts.get(a.sourceKind) ?? 0) + 1);
  }

  return {
    id: runId,
    researchId,
    plannedRoutes,
    completedRoutes: completed.length,
    // ⚠ 失败路**恒可见**——不是被折叠进一个整体成功/失败布尔（E1 的核心断言面）。
    failedRoutes: failed.map((a) => ({ route: a.route, reason: a.reason })),
    sourceCounts: [...counts.entries()].map(([sourceKind, count]) => ({ sourceKind, count })),
    conflictsMarked,
  };
}
