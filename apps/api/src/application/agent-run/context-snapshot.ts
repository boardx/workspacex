/**
 * F157 —— 可审计上下文快照（08-chat/uc-8-7 R3②，人类 2026-08-11「yes to all」逐字签核）。
 *
 * ## 这个文件是什么，不是什么
 *
 * 它是「这次 run 到底喂了什么」这个问题的**记录端口**，不是一个新的组装逻辑。F154（L2 增量
 * 摘要）与 F155（L3 文件式检索）已经把三层组装完了——本文件只在 `execute-run.ts` 三层组装
 * 完成、交给 `ModelCallPort`之前的那个点上，**读**它们已经产出的信息，写成一条不可变快照。
 * 不重新实现、不改变 L1 裁剪 / L2 摘要生成 / L3 召回查询本身的行为（G5 依据本条边界）。
 *
 * ## 降级要如实记录，是本 feature 的核心主张
 *
 * L1/L2/L3 各自的失败降级策略互不相同（见 `execute-run.ts` 对应段落的头注）：
 *   - L1 read 失败 ⇒ 整段历史读取跟着失败，`history` 退回 `[]`（`l1MessageCount` 因此如实记 0）。
 *   - L2 失败 ⇒ 降级为「只有 L1」，`l2Status` 记 `"degraded"`，`l2CoveredThroughId` 记 `null`
 *     （不敢在降级之后还声称一个不可信的边界）。
 *   - L3 失败 ⇒ 同样降级为「本次未召回」，`l3Status` 记 `"degraded"`；`deps.files` 干脆没配置时
 *     记 `"not_configured"`（这是「没打开」，与「打开了但这次失败了」是两个不同的事实，
 *     不应该被同一个值糊在一起）。
 *
 * ## token 估值不是真实 token 数
 *
 * `ModelCallPort.complete` 自己的文档已经说过：这个部署没有真实 tokenizer，一个真实 provider
 * 报回来的 `tokens` 才算数（那是 F159 计量表的事）。这里的 `estimatedTokens` 与
 * `execute-run.ts` 的 `HISTORY_MAX_CHARS` 用的是同一条「约 4 字符/token」保守代理换算，
 * 字面命名为「估值」，绝不会被误读成一个真实计费数字。
 */
import type { OrgId } from "../../domain/org-id";

/**
 * L2/L3 各自这一次 run 的状态：
 *   - `ok`             —— 这一层正常参与了组装（`degraded` 也可能是「这次没有新内容要处理」，
 *                         那不算失败，仍记 `ok`；`l2CoveredThroughId`/`l3HitCount` 会如实反映
 *                         「有没有实质内容」，不需要再靠一个额外枚举值区分）。
 *   - `degraded`        —— 这一层在这次 run 里抛过异常，组装退回了不含它的降级路径。
 *   - `not_configured`  —— 这次执行根本没有接这一层（`deps.files` 缺省）；只对 L3 有意义，
 *                         L2 在 `ExecuteAgentRunDeps` 里永远参与（不是可选依赖），不会取这个值。
 */
export type ContextLayerStatus = "ok" | "degraded" | "not_configured";

/**
 * L3 查询这一次 run 走的是哪条**范围分支**（F156 delta §2 点 2）——与 `l3Sources`
 * （命中的**内容类型**，`chat-attachment`/`canvas-artifact`）是正交的两个维度，不能合并：
 * 一次 `own-attachment` 范围的查询命中的一样是 `chat-attachment` 这个 kind。
 *
 * `own-attachment` —— 个人线程，只吃本线程自己创建者的附件（`FileRetrievalScope.projectId
 * === null`）。`project-retrieval` —— 项目线程，走既有项目范围。一次查询只可能落在其中一支
 * （互斥，见 `pg-file-retrieval.ts` 的两条分支），所以是标量，不是集合。
 */
export type L3RetrievalScope = "own-attachment" | "project-retrieval";

/** 写一条快照需要的全部字段——由 `execute-run.ts` 在三层组装完成的那一刻算出、直接传入。 */
export interface AgentRunContextSnapshotInput {
  readonly runId: string;
  /** L1：本轮最终保留在近端窗口、原样进模型的历史消息条数（不含 L2/L3 前置的伪消息）。 */
  readonly l1MessageCount: number;
  readonly l2Status: Exclude<ContextLayerStatus, "not_configured">;
  /**
   * L2：这次 run 实际生效的摘要覆盖边界——复用 F154 `thread_context_state.summarized_through_id`
   * 同一语义，不重新发明。`null` = 降级，或从未摘要过（两者都意味着「不能声称一个边界」）。
   */
  readonly l2CoveredThroughId: string | null;
  readonly l3Status: ContextLayerStatus;
  /** L3：本轮召回命中条数。未配置/降级时恒为 0。 */
  readonly l3HitCount: number;
  /** L3：命中的来源标记去重集合（`FileRetrievalSourceKind` 的字面值）。未召回时为空数组。 */
  readonly l3Sources: readonly string[];
  /**
   * L3：这次查询走的范围分支（见 `L3RetrievalScope` 文档）。`null` = 这次 run 根本没有发起
   * L3 查询（`l3Status === "not_configured"`）。与 `l3Status`/`l3HitCount` 同级的标量字段。
   */
  readonly l3RetrievalScope: L3RetrievalScope | null;
  /** 保守字符预算换算出的估值，不是真实 token 数——见本文件头注。 */
  readonly estimatedTokens: number;
}

/** 一条快照读回来的样子——多一个 `createdAt`，其余字段与写入时逐字段相同。 */
export interface AgentRunContextSnapshot extends AgentRunContextSnapshotInput {
  readonly createdAt: string;
}

export interface AgentRunContextSnapshotPort {
  /**
   * 写一条快照。幂等：同一 `runId` 的第二次写入是无操作（`executeClaimed` 对每个 run 只会
   * 走到写快照这一步一次——claim 已经是 exactly-once 保证，见 `AgentRunStore.claimQueued`
   * 自己的文档——这里的幂等只是防御性的，不是这条不变量的唯一来源）。
   *
   * 抛错允许（DB 抖动）——调用点降级为「这次没写成快照」，不 fail run：快照是可审计的
   * 观测面，不是运行正确性的一部分，同 F159 计量 `meter()` 那条既有纪律。
   */
  record(orgId: OrgId, snapshot: AgentRunContextSnapshotInput): Promise<void>;

  /** 按 `run_id` 检索一条快照；不存在则 `null`。 */
  findByRunId(orgId: OrgId, runId: string): Promise<AgentRunContextSnapshot | null>;
}

export const AGENT_RUN_CONTEXT_SNAPSHOT = Symbol("AgentRunContextSnapshotPort");
