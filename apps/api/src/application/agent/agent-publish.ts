/**
 * `submitAgentForReview` / `decideAgentPublish`（#660，契约 `agent-runtime.ts:1607` 与 `:1666`）。
 *
 * ## 为什么这个文件存在
 *
 * #660 的现象是「新建的 agent 永远是草稿，发消息报 422」。勘探结论是**不需要新造发布流程**：
 *
 * | 层 | 本 issue 之前的状态 |
 * |---|---|
 * | 契约两个操作 | ✅ 已定义 |
 * | 领域层 `domain/agent/publish-review.ts` 两个门控纯函数 | ✅ **已实现** |
 * | `agents.publish_state` + 四态闭集 CHECK | ✅ 已有（#617 迁移） |
 * | application 用例 | ❌ 零 |
 * | controller / 路由 | ❌ 零 |
 *
 * 也就是说契约、领域、库表都齐了，**只差 application 与 controller 两层没接线**——
 * 与 #617（`createAgent` 零 controller）、#564 审计的「73% 契约无路由」同一形状。
 * 本文件是那条缺失的调用路径，**不重写门控**：判定一律委托给
 * `domain/agent/publish-review.ts`，这里只负责取数、落库、映射错误码。
 *
 * ## ⚠ 三件「故意失败」，不是没做完
 *
 * ① **`securityScanPassed` 老实取自记录，没有扫描记录就是 `false`。**
 *    全仓**没有** agent 侧的安全扫描实现（只有 skill 有）。所以在扫描子系统落地之前，
 *    `批准发布` 会稳定地返回 `SECURITY_SCAN_PENDING`。
 *    ⛔ 这里**不允许**写成 `securityScanPassed: true` 兜底——那正是「静默 fallback」，
 *    会让一个从未被扫过的 agent 直接上线。**失败方向必须是拒绝**（fail-closed）。
 *    这不是 stub：「没有扫描通过的记录」是一个**真实且正确**的回答。
 *
 * ② **`退回` 不查就绪门。** 这不是漏了——领域层注释写明「被否决的正是这些东西，
 *    没必要先让它合格」。所以 `待审核 → 草稿` 这条边今天就完整可用。
 *
 * ③ **本用例不产出可执行的 `AgentVersion` 快照。** `agent_versions.instructions` 是
 *    NOT NULL，而**用户自建 agent 在契约与 schema 里都没有 `instructions` 这个概念**
 *    （`grep instructions packages/contracts/src/agent-runtime.ts` 零命中；`agents` 表无此列）。
 *    补它属于**新契约面**，按 ADR-023 必须人类先签核，agent 不得自行发明。
 *    ⇒ 已作为待签核 delta 登记；在它签核落地之前，`publish_state` 会正确流转，
 *    但 chat 执行链路读的 `published_version_id` 仍为空，**422 依旧存在**。
 *    人类裁决（2026-08-09）：本轮只做状态机，不用 `role` 之类字段硬凑 instructions。
 *
 * ## 评审职能为什么读 `skill_reviewer_functions`
 *
 * 「谁被组织管理员指派为方法论审核人」是**一个事实**，不是 skill 专有的事实（I-5 的表注释
 * 逐字写的是「Who may press approve, assigned by an org admin」，并特意说明它**不**从
 * `org_memberships.org_role` 派生）。本仓已经五次因为「同一事实声明在两处」出事，
 * 所以这里**复用**该表而不是新建 `agent_reviewer_functions`。
 * ⚠ 表名带 `skill_` 前缀是历史遗留（它先为 #552 落地），语义上是组织级评审职能；
 *   改名会牵动 RLS/GRANT/既有迁移，属独立清理动作，已在 #660 里报告，本次不顺手做。
 */
import {
  decideAgentPublish as decideGate,
  submitAgentForReview as submitGate,
} from "../../domain/agent/publish-review";
import type { ToolWhitelistEntryT } from "../../domain/agent/definition";
import type { IdentityRepository } from "../identity/ports";
import { toOrgId } from "../../domain/org-id";

export type AgentPublishStateValue = "草稿" | "待审核" | "运行中" | "已停用";

export type AgentPublishErrorCode =
  | "AGENT_NOT_FOUND"
  | "ROLE_INSUFFICIENT"
  | "MODEL_NOT_SELECTABLE"
  | "TOOL_WHITELIST_EMPTY"
  | "WRONG_REVIEW_FUNCTION"
  | "SELF_REVIEW_FORBIDDEN"
  | "SECURITY_SCAN_PENDING"
  | "METHODOLOGY_REVIEW_PENDING"
  | "ELEVATION_UNDECIDED"
  | "AGENT_STATE_CONFLICT";

export class AgentPublishError extends Error {
  constructor(readonly code: AgentPublishErrorCode) {
    super(code);
    this.name = "AgentPublishError";
  }
}

/** 发布判定要用到的那几列——**不是**整个 `AgentDefinition`，取数只取判定需要的。 */
export interface AgentPublishRecord {
  readonly agentId: string;
  /** `agents.creator_id`。⚠ 提交人取自库里这一行，**绝不**从请求体取（同 skill 评审的纪律）。 */
  readonly submitterId: string;
  readonly publishState: AgentPublishStateValue;
  /** null = 还没选模型 ⇒ `MODEL_NOT_SELECTABLE` */
  readonly modelId: string | null;
  readonly toolWhitelist: readonly ToolWhitelistEntryT[];
}

export interface AgentPublishRepository {
  /** 跨组织读不到 ⇒ null（与 `findForClone` 同一纪律：不区分「不存在」与「不是你的」）。 */
  findForPublish(orgId: string, agentId: string): Promise<AgentPublishRecord | null>;
  /**
   * `publish_state` 的**唯一**合法写入口。
   * ⚠ 领域层注释点名过：除本状态机外没有任何代码路径能把 agent 置为 `运行中`
   *   （`updateAgentDefinition.in.patch` 里根本没有 `publishState` 字段）。
   */
  updatePublishState(
    orgId: string,
    agentId: string,
    next: AgentPublishStateValue,
    actorId: string,
  ): Promise<void>;
  /**
   * 该 agent 最近一次**通过**的安全扫描；没有记录 ⇒ false。
   * ⚠ 见文件头①：今天恒为 false，因为 agent 侧扫描子系统尚不存在。这是 fail-closed 的
   *   真实回答，不是占位——实现它的那天，改的是这个方法的取数，不是门控逻辑。
   */
  securityScanPassed(orgId: string, agentId: string): Promise<boolean>;
}

/** 复用 #552 的组织级评审职能表；见文件头「评审职能为什么读 skill_reviewer_functions」。 */
export interface AgentReviewerFunctionPort {
  /** null = 该 principal 未被指派任何评审职能。 */
  functionOf(orgId: string, principalId: string): Promise<"methodology-reviewer" | "security-reviewer" | null>;
}

export const AGENT_PUBLISH_REPOSITORY = Symbol("AgentPublishRepository");
export const AGENT_REVIEWER_FUNCTION_PORT = Symbol("AgentReviewerFunctionPort");

export interface AgentPublishDeps {
  readonly identities: IdentityRepository;
  readonly repository: AgentPublishRepository;
  readonly reviewerFunctions: AgentReviewerFunctionPort;
}

export interface SubmitAgentForReviewInput {
  readonly orgId: string;
  readonly actorId: string;
  readonly agentId: string;
}

export interface SubmitAgentForReviewResult {
  readonly publishState: "待审核";
  readonly securityScanPassed: boolean;
  readonly elevationRequests: number;
}

/**
 * UC-4.1 R3 步骤 9：提交发布（`草稿 → 待审核`）。
 *
 * 顺序：授权 → 存在性 → 前驱状态 → 选模型 → 白名单（领域层）。
 * 授权最先，与 `create-agent.ts` 逐字同一条理由：否则非成员能靠不同的错误码探测组织内部信息。
 */
export async function submitAgentForReview(
  input: SubmitAgentForReviewInput,
  deps: AgentPublishDeps,
): Promise<SubmitAgentForReviewResult> {
  const membership = await deps.identities.findOrgMembership(input.actorId, toOrgId(input.orgId));
  if (!membership) throw new AgentPublishError("ROLE_INSUFFICIENT");

  const agent = await deps.repository.findForPublish(input.orgId, input.agentId);
  if (agent === null) throw new AgentPublishError("AGENT_NOT_FOUND");

  /* 提交人必须是作者本人或组织管理员——旁人不能替你把草稿推上评审台。 */
  if (agent.submitterId !== input.actorId && membership.orgRole !== "admin") {
    throw new AgentPublishError("ROLE_INSUFFICIENT");
  }

  /* 前驱状态由本状态机自己钉死：只有 `草稿` 能提交。重复提交不是幂等成功，是冲突。 */
  if (agent.publishState !== "草稿") throw new AgentPublishError("AGENT_STATE_CONFLICT");

  /* 契约 `submitAgentForReview.err` 列了 MODEL_NOT_SELECTABLE——没选模型的 agent
     即使发布出去也跑不了，所以在提交这道门就拒。 */
  if (agent.modelId === null) throw new AgentPublishError("MODEL_NOT_SELECTABLE");

  const gate = submitGate({ toolWhitelist: agent.toolWhitelist });
  if (!gate.ok) throw new AgentPublishError(gate.reason);

  await deps.repository.updatePublishState(input.orgId, input.agentId, gate.publishState, input.actorId);

  return {
    publishState: gate.publishState,
    securityScanPassed: await deps.repository.securityScanPassed(input.orgId, input.agentId),
    elevationRequests: agent.toolWhitelist.filter((e) => e.state === "越权申请待确认").length,
  };
}

export interface DecideAgentPublishInput {
  readonly orgId: string;
  readonly actorId: string;
  readonly agentId: string;
  readonly decision: "批准发布" | "退回";
}

export interface DecideAgentPublishResult {
  readonly publishState: AgentPublishStateValue;
  /** ⚠ 仅 `批准发布` 且真的产出了快照时非空；见文件头③，今天恒为 null。 */
  readonly agentVersionId: string | null;
}

/**
 * UC-4.1 R3 步骤 10：批准发布 / 退回（`待审核 → 运行中 | 草稿`）。
 *
 * 判定**整个**委托给 `domain/agent/publish-review.ts` 的 `decideAgentPublish`，
 * 本函数只负责把「谁在问、这个 agent 现在什么样」这两组事实取准。
 */
export async function decideAgentPublish(
  input: DecideAgentPublishInput,
  deps: AgentPublishDeps,
): Promise<DecideAgentPublishResult> {
  const membership = await deps.identities.findOrgMembership(input.actorId, toOrgId(input.orgId));
  if (!membership) throw new AgentPublishError("ROLE_INSUFFICIENT");

  const agent = await deps.repository.findForPublish(input.orgId, input.agentId);
  if (agent === null) throw new AgentPublishError("AGENT_NOT_FOUND");
  if (agent.publishState !== "待审核") throw new AgentPublishError("AGENT_STATE_CONFLICT");

  /**
   * 职能映射：表里存的是 `methodology-reviewer`（#552 的字面量），领域层要的是
   * `methodologyReviewer`（`ReviewFunction`）。这里做一次显式映射而不是让两边"碰巧相等"。
   * ⚠ 未被指派任何职能的人 ⇒ 落到 `orgAdmin`，领域层会给 `WRONG_REVIEW_FUNCTION`——
   *   「是管理员」与「可以批准发布」是两件事，I-5 的表注释专门写过不得互相派生。
   */
  const assigned = await deps.reviewerFunctions.functionOf(input.orgId, input.actorId);
  const actorFunction =
    assigned === "methodology-reviewer" ? "methodologyReviewer" as const
    : assigned === "security-reviewer" ? "securityReviewer" as const
    : "orgAdmin" as const;

  const gate = decideGate({
    agent: { toolWhitelist: agent.toolWhitelist },
    submitterId: agent.submitterId,
    actorId: input.actorId,
    actorFunction,
    decision: input.decision,
    securityScanPassed: await deps.repository.securityScanPassed(input.orgId, input.agentId),
    /**
     * 自动化方法论预检今天没有独立实现——`批准发布` 这个人的动作**本身**就是方法论评审的
     * 人工那一半（领域层字段注释逐字写明），所以这里传 true 表示「没有额外的自动预检拦着」，
     * 而**不是**替人做出了方法论判断。⚠ 与①的 `securityScanPassed` 不同：那一条是
     * 「有没有扫过」的事实，谎报会让未扫的 agent 上线；这一条的人工判定由调用者的身份承担。
     */
    methodologyPrecheckPassed: true,
  });

  if (!gate.ok) throw new AgentPublishError(gate.reason);

  await deps.repository.updatePublishState(input.orgId, input.agentId, gate.publishState, input.actorId);

  return { publishState: gate.publishState, agentVersionId: null };
}
