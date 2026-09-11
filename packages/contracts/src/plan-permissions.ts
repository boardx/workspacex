/**
 * 契约束 `plan-permissions` —— 签核③（API 契约）落点。Phase 14 F06/F07/F08。
 *
 * 设计签核见 `phases/phase-14-agent-kernel-unification/contracts/plan-permissions/`
 * （`design-signoff.md` status: pending，待人类签核）。翻译自
 * `requirements/03-plan-mode-permissions.md` 的 R3/R4/R5/R6/R7，不发挥。
 *
 * ## 这是什么
 *
 * 计划确认（编辑 todo / 确认执行 / 取消）与工具风险分级授权（L0/L1/L2 三档 + 单次/
 * 本 run/以后三档授权粒度）的契约。`AgentKernelRunStatus`（`awaiting_plan_confirmation`/
 * `awaiting_tool_permission`）在 `streaming-transport.ts` 定义——本束**消费**该状态机，
 * 不重新定义（避免同一枚举两处声明）。
 */
import { z } from "zod";
import { AguiPlanTodo } from "./agui-state-events";

/* ── 一、工具风险分级（R5，固定白名单映射，本 phase 不支持组织自定义）──── */

export const ToolRiskLevel = z.enum(["L0", "L1", "L2"]);
export type ToolRiskLevel = z.infer<typeof ToolRiskLevel>;

/* ── 二、计划步骤（可编辑态，Plan Mode 卡片消费）──────────────────────── */

export const PlanStepDraft = z.object({
  planStepId: z.string(),
  /** 复用 AguiPlanTodo 的正文形状，附加计划编辑所需的 id/风险/依赖。 */
  todo: AguiPlanTodo,
  risk: ToolRiskLevel,
  /** 依赖的前置步骤 id；删除前置会让本步骤失去依赖（E2 校验对象）。 */
  dependsOnStepId: z.string().nullable(),
}).strict();
export type PlanStepDraft = z.infer<typeof PlanStepDraft>;

export const PlanConfirmationError = z.enum([
  "NOT_VISIBLE",
  "RUN_NOT_AWAITING_PLAN_CONFIRMATION",
  /** E2：删除必要前置步骤导致后续步骤失去依赖，内核识别并拒绝而非静默执行到中途失败。 */
  "PLAN_INVALID_AFTER_EDIT",
]);
export type PlanConfirmationError = z.infer<typeof PlanConfirmationError>;

export const GetPlanInput = z.object({ runId: z.string().min(1) }).strict();
export type GetPlanInput = z.infer<typeof GetPlanInput>;

export const GetPlanOutput = z.object({
  runId: z.string(),
  steps: z.array(PlanStepDraft),
}).strict();
export type GetPlanOutput = z.infer<typeof GetPlanOutput>;

export const EditPlanStepInput = z.object({
  runId: z.string().min(1),
  planStepId: z.string().min(1),
  /** 编辑正文；删除走 `deletePlanStep`，不是把 content 置空。 */
  content: z.string().refine((s) => s.trim() !== "", "content 不得为空白"),
}).strict();
export type EditPlanStepInput = z.infer<typeof EditPlanStepInput>;

export const DeleteKernelPlanStepInput = z.object({
  runId: z.string().min(1),
  planStepId: z.string().min(1),
}).strict();
export type DeleteKernelPlanStepInput = z.infer<typeof DeleteKernelPlanStepInput>;

export const ConfirmKernelPlanInput = z.object({
  runId: z.string().min(1),
  /** 直接确认 / 编辑后确认，均走本操作；编辑动作已通过上面两个操作先行落地。 */
  steps: z.array(PlanStepDraft),
}).strict();
export type ConfirmKernelPlanInput = z.infer<typeof ConfirmKernelPlanInput>;

/** R4 A1：取消，run 立即进入 `cancelled` 终态（streaming-transport 束定义）。 */
export const CancelPlanInput = z.object({ runId: z.string().min(1) }).strict();
export type CancelPlanInput = z.infer<typeof CancelPlanInput>;

/* ── 三、工具权限确认（R3 步骤 4-6，R5）───────────────────────────────── */

export const ToolPermissionRequest = z.object({
  runId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  risk: z.literal("L2"),
  /** agent 想做什么、为什么——不需要用户去猜。 */
  intent: z.string(),
  rationale: z.string(),
  /** 完整命令/入参内容，不是截断摘要（R6 后置条件）。 */
  command: z.string(),
}).strict();
export type ToolPermissionRequest = z.infer<typeof ToolPermissionRequest>;

/** 四选一：仅本次 / 本次 run 内都允许 / 以后都允许 / 拒绝。 */
export const ToolPermissionDecisionKind = z.enum(["once", "run", "forever", "deny"]);
export type ToolPermissionDecisionKind = z.infer<typeof ToolPermissionDecisionKind>;

export const DecideToolPermissionInput = z.object({
  runId: z.string().min(1),
  toolCallId: z.string().min(1),
  decision: ToolPermissionDecisionKind,
}).strict();
export type DecideToolPermissionInput = z.infer<typeof DecideToolPermissionInput>;

export const ToolPermissionDecisionError = z.enum([
  "NOT_VISIBLE",
  "RUN_NOT_AWAITING_TOOL_PERMISSION",
  /** 竞态：该工具调用已被裁决或 run 已终态。 */
  "TOOL_CALL_ALREADY_DECIDED",
]);
export type ToolPermissionDecisionError = z.infer<typeof ToolPermissionDecisionError>;

/**
 * 「以后都允许」的运行时持久化记录（R5：组织同类操作运行时持久化）。
 *
 * ⚠ issue #3068 更正：F06 落地时这里写的是「不含查看/撤销/批量管理」，而
 * `tool-permission-card.tsx` 同时告诉用户「可在下次弹出时改选拒绝以撤销」——组织级
 * 授权一旦落下那个弹层就再也不会出现，那句话承诺的撤销方式在结构上不可能发生，
 * 一次点击等于永久且不可达。coordinator 裁决 C1（加撤销路径）后，本束新增
 * `listStandingToolGrants` / `revokeStandingToolGrant` 两个操作，均为组织 admin 面
 * （见下方 operations）。批量管理仍不在范围内。
 */
export const StandingToolGrant = z.object({
  orgId: z.string(),
  toolName: z.string(),
  grantedByUserId: z.string(),
  grantedAt: z.string(),
}).strict();
export type StandingToolGrant = z.infer<typeof StandingToolGrant>;

/**
 * issue #3068 —— 组织级授权清单的一行（`listStandingToolGrants.out` 的元素）。
 * 比 `StandingToolGrant` 多一个 `grantId`：撤销必须按行 id 寻址，按 `toolName` 撤
 * 在并发下会撤掉"另一次批准写下的同名那条"。
 */
export const StandingToolGrantListItem = z.object({
  grantId: z.string().min(1),
  toolName: z.string().min(1),
  /** 谁批的；历史行可能缺（F06 只在 `forever` 档记批准人）。 */
  grantedByUserId: z.string().nullable(),
  grantedAt: z.string(),
}).strict();
export type StandingToolGrantListItem = z.infer<typeof StandingToolGrantListItem>;

export const RevokeStandingToolGrantInput = z.object({
  grantId: z.string().min(1),
}).strict();
export type RevokeStandingToolGrantInput = z.infer<typeof RevokeStandingToolGrantInput>;

export const StandingToolGrantError = z.enum([
  /** 组织 admin 面：与模型池同一条判据（`registerModel.err` 的同名值）。 */
  "NOT_ORG_ADMIN",
  /** 该授权不存在，或已被另一位管理员撤销——两者对调用方是同一件事。 */
  "GRANT_NOT_FOUND",
]);
export type StandingToolGrantError = z.infer<typeof StandingToolGrantError>;

/* ── 三之二、`call_skill` 的风险按目标 skill 判定（#2767）──────────────── */

/**
 * #2767（devapp 实测：调用平台 skill `pdf-create` 弹「等待批准」）—— 把 `call_skill`
 * 整体记成 L2 是把"调用 skill 这个动作"当成了风险单位；真正的风险单位是**被调用的那个
 * skill**。本节只声明"skill 怎样宣告自己的等级"与"网关怎样把结论告诉内核"，等级枚举
 * 本身仍是上面那一份 `ToolRiskLevel`（R5 表的三档语义，不另起第二份）。
 *
 * skill 的等级来源（网关 `apps/api` 的 `domain/agent-run/skill-risk-level.ts` 按此顺序判）：
 * 1. 平台官方目录里的四个文档 skill（pptx/docx/xlsx/pdf-create）：目录规格里声明 `L0`——
 *    它们只在不出网的沙箱里生成一个文件给用户下载；
 * 2. `SKILL.md` YAML frontmatter 里的 `risk_level:`（本常量 `SKILL_RISK_FRONTMATTER_KEY`），
 *    值必须是 `ToolRiskLevel` 之一，写错/不认识的值按"未声明"处理；
 * 3. 都没有 ⇒ `SKILL_RISK_DEFAULT_LEVEL`。
 *
 * 缺省档为什么是 L1 而不是 L2：未声明的第三方 skill 今天的执行面与平台 skill 相同
 * （一次独立子模型调用 + 不出网沙箱），按 R5 表 L1 = "默认自动执行，事件带完整入参"
 * （I-3）。真有外发能力（发邮件、外部系统写入）的 skill 应显式声明 `risk_level: L2`。
 * ⚠ 想要"未声明就先问一次"的保守策略，把这个常量改成 `"L2"` 即可（未授权的 L2 走
 * `awaiting_tool_permission`，用户选「本 run 内都允许」后不再问）——一行改动，不需要
 * 改任何判定逻辑。
 */
export const SKILL_RISK_FRONTMATTER_KEY = "risk_level";
export const SKILL_RISK_DEFAULT_LEVEL: ToolRiskLevel = "L1";

/**
 * LangGraph `config.configurable` 里承载「本次 run 里哪些 skill 的 `call_skill` 需要在执行前
 * interrupt」名单的键名——TS 网关（`deep-agent-model-provider.ts`）写、Python `harness.py`
 * 的 `build_interrupt_on` 谓词读，唯一事实源在这里（同 `KERNEL_INTERJECTION_CONFIGURABLE_KEY`
 * 的投影方式；`tests/plan-permissions/cross-lang-skill-hitl-parity.test.ts` 机械比对两侧）。
 *
 * 语义：
 * - 键**缺席** ⇒ 内核对每一次 `call_skill` 都 interrupt（与本 feature 之前逐字相同，
 *   fail-closed——老网关/没挂 skill 的 run 不会因为内核升级而少一次确认）；
 * - 键存在 ⇒ 只有 `skill_stable_name` 在名单内的调用才 interrupt；名单可以为空数组
 *   （本次挂载的 skill 全是 L0/L1）。
 * 名单 = 本次 run 挂载集合里等级为 L2 的 skill 的 stableName；不在挂载集合里的名字
 * 内核本来就执行不了（`call_skill` 回「未知技能」文本），不需要出现在名单里。
 */
export const KERNEL_HITL_SKILLS_CONFIGURABLE_KEY = "hitl_skill_names";
export const KernelHitlSkillNames = z.array(z.string().min(1));
export type KernelHitlSkillNames = z.infer<typeof KernelHitlSkillNames>;

/* ── 三之三、composer 开关「自动批准文档生成所需权限」（#3440）──────────────── */

/**
 * issue #3440 —— composer 里"自动批准文档生成所需权限"开关的读/写。默认关闭，打开
 * 是用户的唯一一次显式同意，此后 PDF/PPTX/DOCX/XLSX 四类文档生成全程零确认
 * （`apps/api` 的 `document-generation-skills.ts` 头注：范围锁死在这四个 skill
 * 各自声明的工具清单上，不是"以后都允许"那种全宽口径开关——复用同一套 standing
 * grant 存储（`tool_permission_grants` scope='forever'，地址是专用常量
 * `document_generation:auto_approve`），但不走 #3068 那条组织 admin 专用路由：
 * 这是一个刻意收窄、预先审过范围的单一能力开关，任何组织成员都能开/关，不是
 * 通用的工具授权管理面。
 */
export const DocumentGenerationAutoApproveStatus = z.object({
  enabled: z.boolean(),
}).strict();
export type DocumentGenerationAutoApproveStatus = z.infer<typeof DocumentGenerationAutoApproveStatus>;

export const SetDocumentGenerationAutoApproveInput = z.object({
  enabled: z.boolean(),
}).strict();
export type SetDocumentGenerationAutoApproveInput = z.infer<typeof SetDocumentGenerationAutoApproveInput>;

/* ── 四、操作 ──────────────────────────────────────────────────────────── */

export const operations = {
  getPlan: {
    method: "GET",
    path: "/agent-runs/:runId/plan",
    in: GetPlanInput,
    out: GetPlanOutput,
    err: ["NOT_VISIBLE"] as const,
  },
  editPlanStep: {
    method: "PATCH",
    path: "/agent-runs/:runId/plan/:planStepId",
    in: EditPlanStepInput,
    out: GetPlanOutput,
    err: ["NOT_VISIBLE", "RUN_NOT_AWAITING_PLAN_CONFIRMATION"] as const,
  },
  deletePlanStep: {
    method: "DELETE",
    path: "/agent-runs/:runId/plan/:planStepId",
    in: DeleteKernelPlanStepInput,
    out: GetPlanOutput,
    err: ["NOT_VISIBLE", "RUN_NOT_AWAITING_PLAN_CONFIRMATION", "PLAN_INVALID_AFTER_EDIT"] as const,
  },
  confirmPlan: {
    method: "POST",
    path: "/agent-runs/:runId/plan/confirm",
    in: ConfirmKernelPlanInput,
    out: z.object({ runId: z.string() }).strict(),
    err: ["NOT_VISIBLE", "RUN_NOT_AWAITING_PLAN_CONFIRMATION"] as const,
  },
  cancelPlan: {
    method: "POST",
    path: "/agent-runs/:runId/plan/cancel",
    in: CancelPlanInput,
    out: z.object({ runId: z.string() }).strict(),
    err: ["NOT_VISIBLE", "RUN_NOT_AWAITING_PLAN_CONFIRMATION"] as const,
  },
  decidePermissionRequest: {
    method: "POST",
    path: "/agent-runs/:runId/permission-requests/:permissionRequestId/decision",
    in: z.object({ runId: z.string().min(1), permissionRequestId: z.string().uuid(), decision: ToolPermissionDecisionKind }).strict(),
    out: z.object({ runId: z.string(), permissionRequestId: z.string().uuid() }).strict(),
    err: ["NOT_VISIBLE", "RUN_NOT_AWAITING_TOOL_PERMISSION"] as const,
  },
  decideToolPermission: {
    method: "POST",
    path: "/agent-runs/:runId/tool-calls/:toolCallId/decision",
    in: DecideToolPermissionInput,
    out: z.object({ runId: z.string(), toolCallId: z.string() }).strict(),
    err: ["NOT_VISIBLE", "RUN_NOT_AWAITING_TOOL_PERMISSION", "TOOL_CALL_ALREADY_DECIDED"] as const,
  },
  /**
   * issue #3068 —— 「以后都允许」的撤销路径。两个操作都是**组织**面而不是 run 面：
   * 这条授权本来就跨 run、无过期，挂在某一次 run 的路由下就等于把撤销入口绑在一个
   * 已经结束的 run 上——那正是今天这个洞的形状。
   */
  listStandingToolGrants: {
    method: "GET",
    path: "/tool-permission-grants",
    in: z.object({}).strict(),
    out: z.array(StandingToolGrantListItem),
    err: ["NOT_ORG_ADMIN"] as const,
  },
  revokeStandingToolGrant: {
    method: "DELETE",
    path: "/tool-permission-grants/:grantId",
    in: RevokeStandingToolGrantInput,
    out: z.object({ grantId: z.string() }).strict(),
    err: ["NOT_ORG_ADMIN", "GRANT_NOT_FOUND"] as const,
  },
  /** issue #3440 —— composer 开关的读/写，非 admin 专用（见上方类型头注）。 */
  getDocumentGenerationAutoApprove: {
    method: "GET",
    path: "/document-generation-auto-approve",
    in: z.object({}).strict(),
    out: DocumentGenerationAutoApproveStatus,
    err: [] as const,
  },
  setDocumentGenerationAutoApprove: {
    method: "PUT",
    path: "/document-generation-auto-approve",
    in: SetDocumentGenerationAutoApproveInput,
    out: DocumentGenerationAutoApproveStatus,
    err: [] as const,
  },
};
