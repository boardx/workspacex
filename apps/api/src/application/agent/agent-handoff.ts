/**
 * AG07 —— Agent 委派 / 转交（handoff）用例（03-agent-role.md R3 ⑨ / E5 / E8；契约束 agent-role UC-7 / I-13；
 * CONTRACT §11 `request-handoff`；ADR-118 #6 权限重查）。
 *
 * 三段：
 *   1. **请求**（`requestAgentHandoff`）：Agent 调 `request_handoff` ⇒ 内核中断 ⇒ `tool-permission-gate.ts`
 *      ⇒ `handoff-gate.ts` ⇒ 这里。按该 run **钉住**的版本快照 `delegationPolicy` 判定目标与深度
 *      （`decideHandoff`），命中则落一行 `requested`（同一次工具调用重放只落一行），结果以 edit resume
 *      交回同一个工具调用。**不新开线程**——必须由发起人确认。
 *   2. **确认 / 取消**（`confirmAgentHandoff` / `cancelAgentHandoff`）：只有发起人本人能看见、能处理
 *      （其他人一律 `HANDOFF_NOT_FOUND`，不泄露存在性）。确认时复核目标当前是否已发布、未停用，
 *      通过则在接收方新开线程（同一事务把状态转成 `confirmed`）。
 *   3. **读**（`listThreadHandoffs`）：来源线程的卡片；转交新开的线程上，交接包 + 以**发起人**身份
 *      重读的引用——无权 / 不存在 ⇒ `readable:false`，不带任何内容（E8，fail closed）。
 *
 * 交接包只含引用 ID（`HandoffPacket.strict()`：多带一个摘录字段即整包拒绝）。
 */
import { HANDOFF_REFUSAL_MARK, RequestHandoffArgs, type HandoffPacket } from "@repo/contracts/agent-role";
import type { z } from "zod";
import {
  decideHandoff, handoffNotAllowedMessage, parseDelegationPolicy,
  type HandoffNotAllowedReason, type HandoffTargetFact,
} from "../../domain/agent/handoff-policy";
import type { OrgId } from "../../domain/org-id";

export type HandoffPacketT = z.infer<typeof HandoffPacket>;
export type HandoffStatusT = "requested" | "confirmed" | "cancelled" | "rejected";

export interface HandoffRecord {
  readonly handoffId: string;
  readonly sourceRunId: string;
  readonly sourceThreadId: string;
  readonly sourceAgentId: string;
  readonly requesterUserId: string;
  readonly targetRole: string;
  readonly targetAgentId: string | null;
  readonly targetName: string | null;
  readonly status: HandoffStatusT;
  readonly packet: HandoffPacketT;
  readonly depth: number;
  readonly notAllowedReason: HandoffNotAllowedReason | null;
  readonly newThreadId: string | null;
  readonly createdAt: string;
}

/** 该 run 钉住的版本快照里 AG07 需要的字段 + 请求人（触发这一轮的人类消息作者）。 */
export interface RunHandoffContext {
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly threadId: string;
  readonly requesterUserId: string | null;
  /** `agent_versions.delegation_policy` 原值（未解析）。 */
  readonly delegationPolicy: unknown;
}

export interface AgentHandoffStore {
  readRunHandoffContext(orgId: OrgId, runId: string): Promise<RunHandoffContext | null>;
  /** 来源线程的转交深度：由某次已确认转交新开的线程 = 那次转交的深度；否则 0。 */
  sourceThreadDepth(orgId: OrgId, threadId: string): Promise<number>;
  /** 本组织里扮演该角色的 Agent（当前事实）；没有 ⇒ null。 */
  resolveTarget(orgId: OrgId, targetRole: string): Promise<(HandoffTargetFact & { readonly name: string }) | null>;
  /** 幂等：同一 run 的同一次工具调用只落一行，重放返回已有行。 */
  insertRequested(orgId: OrgId, row: {
    readonly sourceRunId: string; readonly toolCallId: string; readonly sourceThreadId: string;
    readonly sourceAgentId: string; readonly sourceAgentVersionId: string; readonly requesterUserId: string;
    readonly targetRole: string; readonly targetAgentId: string; readonly targetName: string;
    readonly packet: HandoffPacketT; readonly depth: number;
  }): Promise<HandoffRecord>;
  /** 只按发起人本人读；别人的 ⇒ null。 */
  findForRequester(orgId: OrgId, handoffId: string, userId: string): Promise<HandoffRecord | null>;
  /**
   * 同一事务：`requested → confirmed`（带 `WHERE status='requested'`）+ 以发起人身份新建私有线程。
   * 输了竞态（已被取消 / 已确认）⇒ null，不建线程。
   */
  confirm(orgId: OrgId, input: {
    readonly handoffId: string; readonly userId: string; readonly targetAgentId: string; readonly threadTitle: string;
  }): Promise<HandoffRecord | null>;
  reject(orgId: OrgId, handoffId: string, userId: string, reason: HandoffNotAllowedReason): Promise<HandoffRecord | null>;
  cancel(orgId: OrgId, handoffId: string, userId: string): Promise<HandoffRecord | null>;
  listBySourceThread(orgId: OrgId, threadId: string, userId: string): Promise<readonly HandoffRecord[]>;
  findByNewThread(orgId: OrgId, threadId: string, userId: string): Promise<HandoffRecord | null>;
}

/**
 * D002 决策 6 的 `SourceReadPermissionCheck`：**以给定用户身份**重查一组来源引用的读权限。
 * 读不到（无权 / 不存在 / 查询失败）一律进 `denied`——不区分原因，不泄露存在性。
 */
export interface SourceReadPermissionCheck {
  check(input: { readonly orgId: OrgId; readonly userId: string; readonly sourceRefs: readonly string[] }): Promise<{
    readonly readable: readonly { readonly ref: string; readonly mime: string }[];
    readonly denied: readonly string[];
  }>;
}

export const AGENT_HANDOFF_STORE = Symbol("AgentHandoffStore");
export const SOURCE_READ_PERMISSION_CHECK = Symbol("SourceReadPermissionCheck");

/* ── 一、请求（网关调用）────────────────────────────────────────────── */

export type AgentHandoffRefusalReason = HandoffNotAllowedReason | "invalid_request" | "handoff_unavailable";

export type AgentHandoffOutcome =
  | { readonly status: "requested"; readonly handoffId: string; readonly targetRole: string; readonly message: string }
  | { readonly status: "refused"; readonly targetRole: string | null; readonly reason: AgentHandoffRefusalReason; readonly message: string };

/**
 * UIUX r2 屏 4 #3：拒绝文案里只出现目标的**显示名**（「产品经理」），从不出现角色编号（`D002`）。
 * 解析不到名字时用中性称呼，不回退到编号。
 */
const UNNAMED_TARGET = "所请求的角色";

function refused(reason: AgentHandoffRefusalReason, targetRole: string | null, targetName?: string | null): AgentHandoffOutcome {
  let message: string;
  if (reason === "invalid_request") message = `转交请求的内容不完整（需要目标角色与交接包），未发起转交。${HANDOFF_REFUSAL_MARK}。`;
  else if (reason === "handoff_unavailable") message = `转交功能暂不可用，未发起转交。${HANDOFF_REFUSAL_MARK}；如需要，可以直接联系对应负责人。`;
  else message = handoffNotAllowedMessage(reason, targetName?.trim() || UNNAMED_TARGET);
  return { status: "refused", targetRole, reason, message };
}

/** 解析内核给的工具参数；形状不对（含交接包里夹带摘录等多余字段）返回 null。 */
export function parseRequestHandoffArgs(argsJson: string | null): z.infer<typeof RequestHandoffArgs> | null {
  let raw: unknown;
  try { raw = JSON.parse(argsJson ?? ""); } catch { return null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  // 模型自带的 `outcome` 一律丢弃：结果只由服务端算出。
  const { outcome: _ignored, ...rest } = raw as Record<string, unknown>;
  const parsed = RequestHandoffArgs.safeParse(rest);
  return parsed.success ? parsed.data : null;
}

/** 交回内核的完整工具参数：只取服务端解析过的 targetRole / packet，再附服务端算出的 outcome。 */
export function handoffEditedArgs(argsJson: string | null, outcome: AgentHandoffOutcome): string {
  return JSON.stringify({ ...(parseRequestHandoffArgs(argsJson) ?? {}), outcome });
}

export async function requestAgentHandoff(
  deps: { readonly handoffs?: AgentHandoffStore },
  cmd: { readonly orgId: OrgId; readonly runId: string; readonly toolCallId?: string; readonly argsJson: string | null },
): Promise<AgentHandoffOutcome> {
  const args = parseRequestHandoffArgs(cmd.argsJson);
  if (!args) return refused("invalid_request", null);
  if (!deps.handoffs || !cmd.toolCallId) return refused("handoff_unavailable", args.targetRole);

  const ctx = await deps.handoffs.readRunHandoffContext(cmd.orgId, cmd.runId);
  // 读不到钉住快照或请求人 ⇒ 按「不在允许集」拒绝（fail closed）。
  if (!ctx || !ctx.requesterUserId) return refused("target_not_in_allowed_targets", args.targetRole);

  const policy = parseDelegationPolicy(ctx.delegationPolicy);
  const sourceDepth = await deps.handoffs.sourceThreadDepth(cmd.orgId, ctx.threadId);
  const target = await deps.handoffs.resolveTarget(cmd.orgId, args.targetRole);
  const decision = decideHandoff({ policy, targetRole: args.targetRole, sourceDepth, target });
  if (!decision.ok) return refused(decision.reason, args.targetRole, target?.name);

  const row = await deps.handoffs.insertRequested(cmd.orgId, {
    sourceRunId: cmd.runId, toolCallId: cmd.toolCallId, sourceThreadId: ctx.threadId,
    sourceAgentId: ctx.agentId, sourceAgentVersionId: ctx.agentVersionId, requesterUserId: ctx.requesterUserId,
    targetRole: args.targetRole, targetAgentId: target!.agentId, targetName: target!.name,
    packet: args.packet, depth: decision.depth,
  });
  return {
    status: "requested", handoffId: row.handoffId, targetRole: args.targetRole,
    message: `已提交转交给「${row.targetName ?? args.targetRole}」的请求，等待你在对话中确认；确认后会新开一个对话继续。`,
  };
}

/* ── 二、确认 / 取消（发起人经 HTTP）─────────────────────────────────── */

export class AgentHandoffError extends Error {
  constructor(
    readonly code: "HANDOFF_NOT_FOUND" | "HANDOFF_NOT_ALLOWED",
    readonly reason: HandoffNotAllowedReason | null = null,
  ) {
    super(code);
    this.name = "AgentHandoffError";
  }
}

function threadTitle(packet: HandoffPacketT): string {
  const q = packet.originalQuestion.replace(/\s+/g, " ").trim();
  return `转交：${q.length > 40 ? `${q.slice(0, 40)}…` : q}`;
}

export async function confirmAgentHandoff(
  deps: { readonly handoffs: AgentHandoffStore },
  cmd: { readonly orgId: OrgId; readonly userId: string; readonly handoffId: string },
): Promise<{ handoffId: string; targetAgentId: string; newThreadId: string }> {
  const row = await deps.handoffs.findForRequester(cmd.orgId, cmd.handoffId, cmd.userId);
  if (!row) throw new AgentHandoffError("HANDOFF_NOT_FOUND");
  // 已确认：重复点击返回同一个新线程，不建第二个。
  if (row.status === "confirmed" && row.newThreadId && row.targetAgentId) {
    return { handoffId: row.handoffId, targetAgentId: row.targetAgentId, newThreadId: row.newThreadId };
  }
  if (row.status === "rejected") throw new AgentHandoffError("HANDOFF_NOT_ALLOWED", row.notAllowedReason);
  if (row.status !== "requested") throw new AgentHandoffError("HANDOFF_NOT_FOUND");

  // 目标与深度已在请求时按钉住快照判过（冻结在本行）；这里只复核目标的当前事实。
  const target = await deps.handoffs.resolveTarget(cmd.orgId, row.targetRole);
  const decision = decideHandoff({
    policy: { allowedTargets: [row.targetRole], maxDepth: row.depth },
    targetRole: row.targetRole, sourceDepth: row.depth - 1, target,
  });
  if (!decision.ok) {
    await deps.handoffs.reject(cmd.orgId, row.handoffId, cmd.userId, decision.reason);
    throw new AgentHandoffError("HANDOFF_NOT_ALLOWED", decision.reason);
  }
  const confirmed = await deps.handoffs.confirm(cmd.orgId, {
    handoffId: row.handoffId, userId: cmd.userId, targetAgentId: target!.agentId, threadTitle: threadTitle(row.packet),
  });
  if (!confirmed || !confirmed.newThreadId || !confirmed.targetAgentId) {
    // 输了竞态：别处已确认 ⇒ 读回同一个结果；已取消 ⇒ 不存在。
    const again = await deps.handoffs.findForRequester(cmd.orgId, cmd.handoffId, cmd.userId);
    if (again?.status === "confirmed" && again.newThreadId && again.targetAgentId) {
      return { handoffId: again.handoffId, targetAgentId: again.targetAgentId, newThreadId: again.newThreadId };
    }
    throw new AgentHandoffError("HANDOFF_NOT_FOUND");
  }
  return { handoffId: confirmed.handoffId, targetAgentId: confirmed.targetAgentId, newThreadId: confirmed.newThreadId };
}

export async function cancelAgentHandoff(
  deps: { readonly handoffs: AgentHandoffStore },
  cmd: { readonly orgId: OrgId; readonly userId: string; readonly handoffId: string },
): Promise<{ handoffId: string; status: "cancelled" }> {
  const row = await deps.handoffs.findForRequester(cmd.orgId, cmd.handoffId, cmd.userId);
  if (!row) throw new AgentHandoffError("HANDOFF_NOT_FOUND");
  if (row.status === "cancelled") return { handoffId: row.handoffId, status: "cancelled" };
  if (row.status !== "requested" || !(await deps.handoffs.cancel(cmd.orgId, row.handoffId, cmd.userId))) {
    throw new AgentHandoffError("HANDOFF_NOT_FOUND");
  }
  return { handoffId: row.handoffId, status: "cancelled" };
}

/* ── 三、读 ─────────────────────────────────────────────────────────── */

export function toHandoffView(r: HandoffRecord) {
  return {
    handoffId: r.handoffId, sourceThreadId: r.sourceThreadId, sourceAgentId: r.sourceAgentId, targetRole: r.targetRole,
    targetAgentId: r.targetAgentId, targetName: r.targetName, status: r.status, packet: r.packet,
    depth: r.depth, notAllowedReason: r.notAllowedReason, newThreadId: r.newThreadId, createdAt: r.createdAt,
  };
}

export type HandoffEvidence =
  | { readonly ref: string; readonly readable: true; readonly mime: string }
  | { readonly ref: string; readonly readable: false };

export async function listThreadHandoffs(
  deps: { readonly handoffs: AgentHandoffStore; readonly sources?: SourceReadPermissionCheck },
  cmd: { readonly orgId: OrgId; readonly userId: string; readonly threadId: string },
) {
  const requested = await deps.handoffs.listBySourceThread(cmd.orgId, cmd.threadId, cmd.userId);
  const origin = await deps.handoffs.findByNewThread(cmd.orgId, cmd.threadId, cmd.userId);
  let evidence: HandoffEvidence[] = [];
  if (origin) {
    const refs = origin.packet.evidenceRefs;
    // 以**发起人**身份重读（不是当前查看者，也不是 Agent）；端口缺失或失败 ⇒ 全部不可展示（fail closed）。
    let readable = new Map<string, string>();
    if (deps.sources && refs.length > 0) {
      try {
        const res = await deps.sources.check({ orgId: cmd.orgId, userId: origin.requesterUserId, sourceRefs: refs });
        readable = new Map(res.readable.map((x) => [x.ref, x.mime]));
      } catch {
        readable = new Map();
      }
    }
    evidence = refs.map((ref) => {
      const mime = readable.get(ref);
      return mime === undefined ? { ref, readable: false as const } : { ref, readable: true as const, mime };
    });
  }
  return {
    requested: requested.map(toHandoffView),
    origin: origin ? { handoff: toHandoffView(origin), evidence } : null,
  };
}
