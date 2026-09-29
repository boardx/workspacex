/**
 * AG05 —— Agent 在 run 内请求发起 Workflow（03-agent-role.md R3 / E3；契约束 agent-role UC-5 / I-9；
 * ADR-118 #9）。
 *
 * 生产入口：Agent 调 `start_workflow` 工具 ⇒ 内核（deep-agent / native 两种 runtime 都注册了它，
 * `interrupt_on` 恒为真）在工具执行前中断 ⇒ `tool-permission-gate.ts` ⇒ 这里 ⇒ 结果经 `edit` resume
 * 交回同一个工具调用，工具体把 `outcome.message` 告诉 Agent。没有新的 HTTP 面。
 *
 * 判定顺序（每一步失败都不创建实例、不改走其它 Workflow）：
 *   1. 参数：`workflowId` 必须是契约 `agentRole.WorkflowStableId`（`W0xx`），`input` 是对象；
 *   2. run 上下文：该 run **钉住**的 Agent 版本快照（`agent_runs.agent_version_id` 的 `workflow_allowlist`）
 *      与请求人（触发这一轮的人类消息作者）——读不到一律 `workflow_not_allowed`（fail closed）；
 *   3. 白名单：精确匹配钉住快照的 `workflowAllowlist`；未命中 ⇒ `workflow_not_allowed` + 可转交角色；
 *   4. 稳定编号 → Runtime key（代码自带的内容线注册表）；未注册 ⇒ `workflow_not_found`；
 *   5. 真正的 WF03 start（`WorkflowRuntimeService.start` ⇒ `startInstance` ⇒ `runStartCore`）：以请求人身份、
 *      以本 run 的 Agent 发起，Runtime 自己再做可见性 / 可运行 Agent / 已发布白名单 / 已发布版本 /
 *      Skill 版本（由 Workflow 固定，Agent 无需挂载）/ 输入校验——任何一条拒绝原样带回。
 *   `requestId` 由 run + 工具调用 id 派生：同一次工具调用重放（崩溃恢复）命中 WF03 的 A1 幂等，只建 1 个实例。
 *
 * 结果文案是聊天可见的中文句子（契约束 agent-role ui.md：「该角色不能发起此流程」），不含原始错误码。
 */
import { createHash } from "node:crypto";
import { WorkflowStableId } from "@repo/contracts/agent-role";
import type { WorkflowErrorCode, WorkflowInstanceStatus } from "@repo/contracts/workflow-runtime";
import { contentWorkflowKeyOf, workflowAllowlistRefusal } from "../../domain/agent/workflow-allowlist";
import type { OrgId } from "../../domain/org-id";
import type { AgentRunStore } from "../agent-run/ports";
import type { StartInstanceResponse } from "../workflow/instance-commands";
import { WorkflowUseCaseError } from "../workflow/workflow-errors";
import type { WorkflowReceiptStore } from "../workflow/workflow-ports";

/** 内核工具名（Python `tools.py` 的 `start_workflow`；原生准入表经生成物同步到 Python 侧）。 */
export const AGENT_WORKFLOW_START_TOOL_NAME = "start_workflow" as const;

/** 契约束 agent-role ui.md：白名单拒绝时聊天可见的文案。 */
export const WORKFLOW_NOT_ALLOWED_CHAT_COPY = "该角色不能发起此流程";

/** WF03 start 的调用面——生产实现就是 `WorkflowRuntimeService`（同一个 DI 单例）。 */
export interface AgentWorkflowStartPort {
  start(orgId: string, userId: string, pathKey: string, body: unknown): Promise<StartInstanceResponse>;
}

/** 该 run 钉住的 Agent 版本快照（只取 AG05 需要的字段）+ 请求人。 */
export interface AgentRunWorkflowContext {
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly workflowAllowlist: readonly string[];
  readonly requesterUserId: string | null;
}

export type AgentWorkflowStartRefusalCode = WorkflowErrorCode | "workflow_runtime_unavailable"
  /** 仅恢复路径：WF03 回执已 begin 但未 finalize（进程在 start 途中消失）——实例是否已建无法确认，不说「未发起」。 */
  | "workflow_start_unconfirmed";

export type AgentWorkflowStartOutcome =
  | {
      readonly status: "started";
      readonly workflowId: string;
      readonly instanceId: string;
      readonly instanceStatus: WorkflowInstanceStatus;
      readonly definitionVersion: number;
      readonly message: string;
    }
  | {
      readonly status: "refused";
      readonly workflowId: string | null;
      readonly code: AgentWorkflowStartRefusalCode;
      readonly handoffCandidates: readonly string[];
      readonly message: string;
    };

export interface RequestAgentWorkflowStartDeps {
  readonly runs: Pick<AgentRunStore, "readRunWorkflowContext">;
  /** 未接线 ⇒ 如实拒绝（`workflow_runtime_unavailable`），不假装发起。生产合成必定注入。 */
  readonly workflows?: AgentWorkflowStartPort;
  readonly log?: (message: string, detail: Record<string, unknown>) => void;
}

export interface RequestAgentWorkflowStartCommand {
  readonly orgId: OrgId;
  readonly runId: string;
  readonly toolCallId?: string;
  /** 内核给的工具参数 JSON（`InterruptedToolCall.argsSummary`）。 */
  readonly argsJson: string | null;
}

function refusalMessage(code: AgentWorkflowStartRefusalCode, workflowId: string | null, handoff: readonly string[]): string {
  const wf = workflowId ?? "所请求的流程";
  switch (code) {
    case "workflow_not_allowed":
      return `${WORKFLOW_NOT_ALLOWED_CHAT_COPY}（${wf}），未创建实例。${handoff.length > 0 ? `可转交给角色：${handoff.join("、")}。` : ""}`;
    case "workflow_not_found":
      return `该流程尚未上线（${wf}），未创建实例。`;
    case "workflow_version_not_published":
      return `流程 ${wf} 尚未发布，未创建实例。`;
    case "skill_version_unresolved":
      return `流程 ${wf} 固定的技能版本在本组织不可用，未创建实例。`;
    case "trigger_input_invalid":
      return `发起流程的参数不符合要求，未创建实例。`;
    case "workflow_runtime_unavailable":
      return `流程运行时暂不可用，未创建实例。`;
    case "workflow_start_unconfirmed":
      return `发起流程 ${wf} 的过程被中断，无法确认实例是否已创建。请到流程列表核对，不要重复发起。`;
    default:
      return `流程 ${wf} 未能发起，未创建实例。`;
  }
}

export function refusedOutcome(code: AgentWorkflowStartRefusalCode, workflowId: string | null, handoffCandidates: readonly string[] = []): AgentWorkflowStartOutcome {
  return refused(code, workflowId, handoffCandidates);
}

export function startedOutcome(workflowId: string, started: Pick<StartInstanceResponse, "instanceId" | "status" | "definitionVersion">): AgentWorkflowStartOutcome {
  return {
    status: "started", workflowId, instanceId: started.instanceId, instanceStatus: started.status,
    definitionVersion: started.definitionVersion,
    message: `已发起流程 ${workflowId}（实例 ${started.instanceId}），流程正在后台运行。`,
  };
}

/** WF03 `requestId`：同一 run 的同一次工具调用恒得同一个键（A1 幂等；恢复路径据此只读查回执）。 */
export function agentWorkflowStartRequestId(runId: string, toolCallId: string): string {
  return `agent-run:${createHash("sha256").update(`${runId}\u0000${toolCallId}`).digest("hex").slice(0, 48)}`;
}

/** 交回内核的完整工具参数：只取服务端解析过的 workflowId / input，模型自带的任何 `outcome` 一律丢弃。 */
export function workflowStartEditedArgs(argsJson: string | null, outcome: AgentWorkflowStartOutcome): string {
  return JSON.stringify({ ...(parseWorkflowStartArgs(argsJson) ?? {}), outcome });
}

function refused(code: AgentWorkflowStartRefusalCode, workflowId: string | null, handoffCandidates: readonly string[] = []): AgentWorkflowStartOutcome {
  return { status: "refused", workflowId, code, handoffCandidates: [...handoffCandidates], message: refusalMessage(code, workflowId, handoffCandidates) };
}

/** 解析内核给的工具参数；形状不对返回 null。 */
export function parseWorkflowStartArgs(argsJson: string | null): { workflowId: string; input: Record<string, unknown> } | null {
  let raw: unknown;
  try { raw = JSON.parse(argsJson ?? ""); } catch { return null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const args = raw as Record<string, unknown>;
  const id = WorkflowStableId.safeParse(args.workflowId);
  if (!id.success) return null;
  const input = args.input ?? {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  return { workflowId: id.data, input: input as Record<string, unknown> };
}

export async function requestAgentWorkflowStart(
  deps: RequestAgentWorkflowStartDeps,
  cmd: RequestAgentWorkflowStartCommand,
): Promise<AgentWorkflowStartOutcome> {
  const args = parseWorkflowStartArgs(cmd.argsJson);
  if (!args) return refused("trigger_input_invalid", null);

  const ctx = (await deps.runs.readRunWorkflowContext?.(cmd.orgId, cmd.runId)) ?? null;
  if (!ctx || !ctx.requesterUserId) return refused("workflow_not_allowed", args.workflowId);

  const refusal = workflowAllowlistRefusal(ctx.agentId, args.workflowId, ctx.workflowAllowlist);
  if (refusal) return refused("workflow_not_allowed", args.workflowId, refusal.handoffCandidates);

  const key = contentWorkflowKeyOf(args.workflowId);
  if (!key) return refused("workflow_not_found", args.workflowId);
  if (!deps.workflows) return refused("workflow_runtime_unavailable", args.workflowId);

  // WorkflowRequestId 有长度上限（8–200）：run / 工具调用 id 摘要后拼接，稳定且有界。
  // 没有工具调用 id 就无法区分同一 run 内的两次合法调用（A1 会把第二次当重放）——如实拒绝，不发起。
  if (!cmd.toolCallId) return refused("workflow_runtime_unavailable", args.workflowId);
  const requestId = agentWorkflowStartRequestId(cmd.runId, cmd.toolCallId);
  try {
    const started = await deps.workflows.start(cmd.orgId, ctx.requesterUserId, key, {
      agentId: ctx.agentId,
      requestId,
      input: args.input,
    });
    return startedOutcome(args.workflowId, started);
  } catch (e) {
    if (e instanceof WorkflowUseCaseError) {
      return refused(e.code, args.workflowId, e.details.allowlistHint?.handoffCandidates ?? []);
    }
    deps.log?.("agent workflow start failed", { runId: cmd.runId, workflowId: args.workflowId, detail: e instanceof Error ? e.name : "unknown" });
    return refused("workflow_runtime_unavailable", args.workflowId);
  }
}

/**
 * 恢复路径（进程死在网关判定中途、run 从检查点读回「停在 start_workflow 上」）：**只读**查该工具调用的 WF03
 * start 回执（同一 requestId），不做任何新提交。回执已落定且带实例 ⇒ started（同一实例）；无回执 ⇒ 未发起；
 * 回执未落定 ⇒ 无法确认（workflow_start_unconfirmed）。
 */
export async function recoverAgentWorkflowStart(
  receipts: Pick<WorkflowReceiptStore, "find">,
  cmd: { readonly orgId: string; readonly runId: string; readonly argsJson: string | null; readonly toolCallId?: string },
): Promise<AgentWorkflowStartOutcome> {
  const args = parseWorkflowStartArgs(cmd.argsJson);
  if (!args) return refused("trigger_input_invalid", null);
  if (!cmd.toolCallId) return refused("workflow_runtime_unavailable", args.workflowId);
  const row = await receipts.find(cmd.orgId, "command", `start:${agentWorkflowStartRequestId(cmd.runId, cmd.toolCallId)}`);
  // 无回执 ⇒ WF03 从未受理这次调用（begin 是 start 的第一步）⇒ 如实「未发起」。
  if (!row) return refused("workflow_runtime_unavailable", args.workflowId);
  const r = (row.status === "finalized" ? row.stableResponse : null) as { instanceId?: unknown; status?: unknown; definitionVersion?: unknown } | null;
  if (r && typeof r.instanceId === "string" && typeof r.status === "string" && typeof r.definitionVersion === "number") {
    return startedOutcome(args.workflowId, { instanceId: r.instanceId, status: r.status as WorkflowInstanceStatus, definitionVersion: r.definitionVersion });
  }
  // 已落定的 WF03 拒绝（A1 存的稳定拒绝）⇒ 同一个拒绝码，与网关当时会给的一致。
  const rejection = (row.status === "finalized" ? row.stableResponse : null) as { workflowRejection?: { code?: unknown; details?: { allowlistHint?: { handoffCandidates?: unknown } } } } | null;
  if (rejection?.workflowRejection && typeof rejection.workflowRejection.code === "string") {
    const handoff = rejection.workflowRejection.details?.allowlistHint?.handoffCandidates;
    return refused(rejection.workflowRejection.code as WorkflowErrorCode, args.workflowId, Array.isArray(handoff) ? handoff.filter((x): x is string => typeof x === "string") : []);
  }
  // begun / reconciled / unresolved：start 途中断了（begin、建实例、finalize 是三个事务），实例可能已建——
  // 不说「未发起」，如实说无法确认、不要重复发起。
  return refused("workflow_start_unconfirmed", args.workflowId);
}
