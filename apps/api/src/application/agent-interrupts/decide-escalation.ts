/**
 * AG06 —— escalate 中断的发起与裁决（契约 `agentRole.operations.decideEscalation`，
 * 03-agent-role.md R3 ⑧、E6、E7）。
 *
 * - `raiseEscalation`：Agent 命中 escalationPolicy（matter 精确匹配一条规则）⇒ run 进入
 *   `awaiting_tool_permission`，待决工具名是 `ESCALATE_TOOL_NAME`、参数是 `EscalatePayload`
 *   JSON。没命中规则 ⇒ 不挂起（返回 `null`）。复用既有 `markAwaitingToolPermission`，不另写 SQL。
 * - `decideEscalation`：**决策人集合只从服务端持久化的状态解析**——pending 中断里的
 *   `target` 必须仍由该 run 钉住的 agent 版本的 escalationPolicy 支撑（同 matter 同 target），
 *   再由 store 把 target（requester / project_owner / org_admin）展开成用户 ID；客户端传不进来。
 *   然后走 `guardAgentInterruptDecision`（kind 与身份），通过后用既有
 *   `decidePermissionRequest` 的 `edit` 边把决策原文落 `pending_edited_args` 并重新入队——
 *   resolve 与 reject 都恢复 run（reject 是告诉 Agent「人不同意」，不是杀掉 run），
 *   裁决同一条 UPDATE 追加进 `resolved_approvals`（审计与生效原子，故 auditWritable 恒真）。
 * - E7：本文件没有任何超时分支；超时路径见 escalate-decision.ts 头注。
 */
import { AGENT_INTERRUPT_KIND_TO_TOOL_NAME, type AgentInterruptKind } from "@repo/contracts/agent-interrupts";
import { EscalatePayload, EscalationPolicy, EscalationTarget, ESCALATE_TOOL_NAME } from "@repo/contracts/agent-role";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { AgentRunStore } from "../agent-run/ports";
import { guardAgentInterruptDecision, type PendingInterrupt } from "./decision-guard";
import { parseEscalateResumePayload } from "./escalate-decision";

type Target = z.infer<typeof EscalationTarget>;
type EscalatePayloadT = z.infer<typeof EscalatePayload>;

/** store 返回的持久化事实——全部来自数据库，不来自请求。 */
export interface PendingEscalationRow {
  readonly runId: string;
  readonly toolName: string;
  readonly argsSummary: string | null;
  /** 该 run 钉住的 agent 版本上的 escalation_policy 原值（未解析）。 */
  readonly escalationPolicy: unknown;
  /** 触发该 run 的输入消息作者。 */
  readonly requesterUserId: string | null;
  readonly projectId: string | null;
}

export interface EscalationStore {
  /** 仅返回 `awaiting_tool_permission` 且 `pending_permission_request_id = interruptId` 的 run。 */
  findPendingByInterruptId(orgId: OrgId, interruptId: string): Promise<PendingEscalationRow | null>;
  /** 把 target 展开为用户 ID：requester=输入消息作者；project_owner=项目 host facilitator；org_admin=组织 admin。 */
  listTargetUserIds(orgId: OrgId, target: Target, scope: { readonly requesterUserId: string | null; readonly projectId: string | null }): Promise<readonly string[]>;
}
export const ESCALATION_STORE = Symbol("EscalationStore");

export type DecideEscalationErrorCode =
  | "AGENT_NOT_FOUND" | "ESCALATION_DECIDER_FORBIDDEN" | "INTERRUPT_KIND_MISMATCH" | "VALIDATION_FAILED";
export class DecideEscalationError extends Error {
  constructor(readonly code: DecideEscalationErrorCode) { super(code); }
}

export interface DecideEscalationDeps {
  readonly escalations: EscalationStore;
  readonly runs: Pick<AgentRunStore, "decidePermissionRequest">;
  readonly kick: (orgId: OrgId) => void;
}

function kindOfTool(toolName: string): AgentInterruptKind | null {
  const hit = (Object.entries(AGENT_INTERRUPT_KIND_TO_TOOL_NAME) as [AgentInterruptKind, string][])
    .find(([, name]) => name === toolName);
  return hit ? hit[0] : null;
}

/** fail closed：载荷或策略解析不出来、或 target 不再被策略支撑 ⇒ 空集合（无人可裁决）。 */
async function eligibleDeciders(deps: DecideEscalationDeps, orgId: OrgId, row: PendingEscalationRow): Promise<readonly string[]> {
  let payload: EscalatePayloadT;
  try { payload = EscalatePayload.parse(JSON.parse(row.argsSummary ?? "")); } catch { return []; }
  const policy = EscalationPolicy.safeParse(row.escalationPolicy);
  if (!policy.success) return [];
  const backed = policy.data.rules.some((r) => r.matter === payload.matter && r.target === payload.target);
  if (!backed) return [];
  return deps.escalations.listTargetUserIds(orgId, payload.target, { requesterUserId: row.requesterUserId, projectId: row.projectId });
}

export async function decideEscalation(
  deps: DecideEscalationDeps,
  input: { readonly orgId: OrgId; readonly userId: string; readonly interruptId: string; readonly rawDecision: unknown },
): Promise<{ readonly interruptId: string; readonly status: "resolved" | "rejected" }> {
  const row = await deps.escalations.findPendingByInterruptId(input.orgId, input.interruptId);
  const kind = row ? kindOfTool(row.toolName) : null;
  const pendingInterrupt: PendingInterrupt | null = row && kind ? { kind, requestId: input.interruptId } : null;
  const raw = input.rawDecision === undefined ? "" : JSON.stringify(input.rawDecision);
  const payload = parseEscalateResumePayload(raw, input.interruptId);
  const escalation = row && kind === "escalate"
    ? { deciderId: input.userId, eligibleDeciderIds: await eligibleDeciders(deps, input.orgId, row) }
    : undefined;
  const refused = guardAgentInterruptDecision({
    visible: row !== null, canWrite: true, pendingInterrupt, payload, auditWritable: true, escalation,
  });
  switch (refused) {
    case null: break;
    case "ESCALATION_DECIDER_FORBIDDEN":
    case "INTERRUPT_KIND_MISMATCH":
      throw new DecideEscalationError(refused);
    case "MALFORMED_RESUME_PAYLOAD":
      throw new DecideEscalationError("VALIDATION_FAILED");
    default:
      throw new DecideEscalationError("AGENT_NOT_FOUND");
  }
  // 本端点只裁决 escalate：其他 kind 的中断即便载荷形状与之相符，也必须走它们自己的
  // decideAgentRun 通路（那里有 validateInterruptDecision），不许借道绕过。
  if (kind !== "escalate") throw new DecideEscalationError("INTERRUPT_KIND_MISMATCH");
  // guard 已放行 ⇒ row 非空且 rawDecision 是合法 EscalateDecision。
  const decision = input.rawDecision as { readonly decision: "resolve" | "reject" };
  const decided = await deps.runs.decidePermissionRequest?.(
    input.orgId, row!.runId, input.interruptId, "edit", input.userId, JSON.stringify(input.rawDecision),
  );
  // 输了竞态（别人先裁决）：中断已不在待决态。
  if (!decided) throw new DecideEscalationError("AGENT_NOT_FOUND");
  deps.kick(input.orgId);
  return { interruptId: input.interruptId, status: decision.decision === "resolve" ? "resolved" : "rejected" };
}

/**
 * Agent 请求升级：matter 命中 policy 规则 ⇒ 挂起 run 等目标人；否则返回 `null`（不挂起）。
 * target 取规则里的值，不取 Agent 自报——Agent 不能自己挑谁来批。
 */
export async function raiseEscalation(
  deps: { readonly runs: Pick<AgentRunStore, "markAwaitingToolPermission"> },
  input: {
    readonly orgId: OrgId; readonly runId: string; readonly policy: unknown;
    readonly matter: string; readonly reason: string; readonly contextRefs: readonly string[];
  },
): Promise<EscalatePayloadT | null> {
  const policy = EscalationPolicy.safeParse(input.policy);
  if (!policy.success) return null;
  const rule = policy.data.rules.find((r) => r.matter === input.matter);
  if (!rule) return null;
  const payload = EscalatePayload.parse({ matter: rule.matter, reason: input.reason, target: rule.target, contextRefs: [...input.contextRefs] });
  await deps.runs.markAwaitingToolPermission(input.orgId, input.runId, {
    toolName: ESCALATE_TOOL_NAME, argsSummary: JSON.stringify(payload), interrupt: null,
  });
  return payload;
}
