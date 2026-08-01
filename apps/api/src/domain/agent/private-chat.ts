/**
 * F59 -- UC-4.3 与单个 agent 私聊：会话隔离 + 转出出处 + 不构成提权 + 项目层可审计。
 *
 * `user_visible_behavior`: 「私聊消息不进入主线程的转录/洞察/产物三栏、不计入线程消息数；
 * 把一条结论转到主线程时带完整出处（agent + skill 版本 + 时间 + 数据来源）；私聊仍受三层
 * 权限与项目级 AI 权限约束，不构成提权……私聊正文归项目层，组织管理员可读但每次访问写审计
 * 且对项目负责人可见……组员默认无私聊入口，由引导师逐场开关（不跨场继承）；发起私聊前后
 * 线程 agent 在场名单与计数不变。」
 *
 * ## Why this composes F55/F56 rather than re-deriving their facts
 *
 * `visibleOnSurface(agent, "private-chat")` (F55, `lifecycle.ts`) already IS the single
 * source for "is this agent currently reachable for private chat" -- it is keyed off the
 * same `publishState` that governs the roster and the loadable pool. Re-deriving "agent must
 * be 运行中" here as a second boolean check would be exactly the kind of "same fact, two
 * places" drift AGENTS.md calls out five prior instances of.
 *
 * `intersectAgentPermission` (F56, `three-layer-permission.ts`) is reused UNCHANGED for the
 * "not a privilege escalation" guarantee (AC2 / V2): the entire point of that test is that
 * private chat must produce the IDENTICAL allow/deny verdict a main-thread tool call with the
 * same three facts would get. A private-chat-specific reimplementation of the merge rule
 * could silently diverge from the main-thread one and grant something main-thread wouldn't --
 * which is privilege escalation by definition, not a hypothetical.
 *
 * ## Why the project-level canvas-write gate is layered ON TOP of, not INSIDE, the three-layer merge
 *
 * `canvas.ts`'s `KNOWN_CONTRACT_GAPS.C_CANVAS_1` records that the three-granularity AI write
 * permission (section/project/canvas) has no defined intersection semantics; only the
 * canvas-level toggle is contracted. This module does not attempt to solve that open gap --
 * it only asserts the one deterministic rule R2 step 2 actually states: when the PROJECT-level
 * "AI 直接在小组画布落笔" toggle is off, a private-chat canvas-write action is refused
 * regardless of what the three-layer merge would otherwise allow. That is an additional,
 * independent AND -- never a path that could turn a three-layer denial into an allow.
 *
 * ## Why session start takes no roster and returns no roster (V16)
 *
 * "发起私聊前后线程 agent 在场名单与计数不变" (E-3 / R10) is proven not by re-checking
 * equality after the fact, but by `startPrivateChatSession`'s signature: it has no roster
 * parameter and no roster field in its return type, so there is no code path through which
 * starting a session could read OR write the thread roster. `assertRosterUnchanged` exists
 * only for callers who additionally want an executable check across their own before/after
 * snapshots.
 */
import { agentRuntime as A, agentPrivateChat as PC } from "@repo/contracts";
import type { z } from "zod";
import { visibleOnSurface } from "./lifecycle";
import type { AgentDefinition } from "./definition";
import {
  intersectAgentPermission,
  type ThreeLayerInput,
  type ThreeLayerResult,
} from "./three-layer-permission";

type ProjectRoleT = "facilitator" | "groupLead" | "member" | "observer";
type PrivateChatErrorName =
  | "NOT_VISIBLE"
  | "OBSERVER_NO_ENTRY"
  | "MEMBER_TOGGLE_DISABLED"
  | "AGENT_NOT_RUNNING"
  | "TOOL_NOT_WHITELISTED"
  | "CANVAS_WRITE_DISABLED_PROJECT_LEVEL"
  | "THREAD_ARCHIVED_READONLY"
  | "INCOMPLETE_PROVENANCE";

export type AgentPresenceT = z.infer<typeof A.AgentPresence>;
export type SkillMountT = z.infer<typeof A.SkillMount>;

/* ══════════════════════ ① 入口鉴权（R4 A1, R5, V5, V6, V15）══════════════════════ */

export interface PrivateChatEntryInput {
  readonly role: ProjectRoleT;
  /** I-52 的可见性范围（"仅本组" agent 对平台组成员不可见，V6）由上游算好，这里只读结论。 */
  readonly agentVisibleToUser: boolean;
  readonly agent: Pick<AgentDefinition, "publishState">;
  /** 组员本场是否已被引导师开关打开——facilitator/groupLead/observer 不看这个字段。 */
  readonly memberToggleEnabledForThread: boolean;
}

export interface PrivateChatEntryResult {
  readonly allowed: boolean;
  readonly reason: PrivateChatErrorName | null;
}

/**
 * R5 的角色矩阵，收口成一个总函数：
 *   observer  -- 恒拒绝，无私聊入口（A1）
 *   member    -- 仅当本场开关已开才允许（O-24 · V15）
 *   groupLead / facilitator -- 只要 agent 可见且运行中就允许
 *     （组长限本组 agent 的可见性判定在 `agentVisibleToUser` 里已经算完，这里不重算）
 */
export function authorizePrivateChatEntry(
  input: PrivateChatEntryInput,
): PrivateChatEntryResult {
  if (input.role === "observer") {
    return { allowed: false, reason: "OBSERVER_NO_ENTRY" };
  }
  if (!input.agentVisibleToUser) {
    return { allowed: false, reason: "NOT_VISIBLE" };
  }
  if (!visibleOnSurface(input.agent, "private-chat")) {
    return { allowed: false, reason: "AGENT_NOT_RUNNING" };
  }
  if (input.role === "member" && !input.memberToggleEnabledForThread) {
    return { allowed: false, reason: "MEMBER_TOGGLE_DISABLED" };
  }
  return { allowed: true, reason: null };
}

/* ══════════════════════ ② 不构成提权（AC2 / V2）══════════════════════ */

export interface PrivateChatActionInput {
  readonly threeLayer: ThreeLayerInput;
  readonly isCanvasWriteAction: boolean;
  /** 项目级「AI 直接在小组画布落笔」开关（thresholds.ts 的默认值由上游解出，这里只读结论）。 */
  readonly projectCanvasWriteEnabled: boolean;
}

export interface PrivateChatActionResult {
  readonly allowed: boolean;
  readonly reason: PrivateChatErrorName | null;
  /** 三层求交的完整解释，供"为什么被拒"面板复用（与主线程同一份解释，不另造一套文案）。 */
  readonly threeLayer: ThreeLayerResult;
}

/**
 * 私聊里的一次工具/动作请求。**不是**一个私聊专属的权限体系——它就是
 * `intersectAgentPermission` 本身，外加项目级画布落笔开关这一条独立 AND。
 *
 * ⚠ 顺序很重要：先求三层交集，交集已拒绝就不再看画布开关（避免"两条理由,只报一条"
 * 掩盖了本该是三层否决的真相）；三层放行后画布开关才有资格否决，且只否决画布类动作，
 * 不影响其它工具调用（R2 步骤 2 只说画布落笔，未扩大到全部工具）。
 */
export function authorizePrivateChatAction(
  input: PrivateChatActionInput,
): PrivateChatActionResult {
  const threeLayer = intersectAgentPermission(input.threeLayer);
  if (!threeLayer.allowed) {
    return { allowed: false, reason: "TOOL_NOT_WHITELISTED", threeLayer };
  }
  if (input.isCanvasWriteAction && !input.projectCanvasWriteEnabled) {
    return { allowed: false, reason: "CANVAS_WRITE_DISABLED_PROJECT_LEVEL", threeLayer };
  }
  return { allowed: true, reason: null, threeLayer };
}

/* ══════════════════════ ③ 会话发起：不改编制（V16）══════════════════════ */

export interface StartPrivateChatSessionInput {
  readonly sessionId: string;
  readonly threadId: string;
  readonly projectId: string;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly initiatorId: string;
  readonly initiatorRole: ProjectRoleT;
  readonly createdAt: string;
}

export type PrivateChatSessionT = z.infer<typeof PC.PrivateChatSession>;

/**
 * 建会话。⚠ 签名里**没有 roster 参数、返回值里也没有 roster 字段**——
 * 这是 V16 的证明手段，不是省略：私聊发起这条代码路径根本摸不到 roster，
 * 就不存在"顺手改了在场名单"的空间。
 */
export function startPrivateChatSession(
  input: StartPrivateChatSessionInput,
): PrivateChatSessionT {
  return { ...input };
}

/** 供调用方对自己的前后 roster 快照做一次可执行断言（不是本模块唯一的证明手段，见上）。 */
export function assertRosterUnchanged(
  before: readonly AgentPresenceT[],
  after: readonly AgentPresenceT[],
): boolean {
  if (before.length !== after.length) return false;
  return before.every((entry, i) => {
    const other = after[i];
    return (
      other !== undefined &&
      entry.agentId === other.agentId &&
      entry.presence === other.presence &&
      entry.agentVersionId === other.agentVersionId
    );
  });
}

/* ══════════════════════ ④ 隔离：不进主线程三栏、不计入消息数（V4）══════════════════════ */

export interface ScopedThreadItem {
  readonly scope: "main" | "private-chat";
}

/**
 * 主线程的转录/洞察/产物三栏与消息计数**只能**从 `scope: "main"` 的条目算出——
 * 私聊条目共享同一份底层事件流（同一 agent、同一线程 ID 空间）时，唯一能防止它们
 * 泄漏进主线程投影的办法就是在读侧先过滤，而不是指望写侧"记得"分开建表。
 */
export function excludeFromMainThreadProjection<T extends ScopedThreadItem>(
  items: readonly T[],
): readonly T[] {
  return items.filter((item) => item.scope === "main");
}

export function countMainThreadMessages<T extends ScopedThreadItem>(
  items: readonly T[],
): number {
  return excludeFromMainThreadProjection(items).length;
}

/* ══════════════════════ ⑤ 转出到主线程：完整出处（AC1 / V1 / R7）══════════════════════ */

export interface BuildHandoffProvenanceInput {
  readonly sourceSessionId: string;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly skillMounts: readonly SkillMountT[];
  readonly dataSources: readonly string[];
  readonly handedOffAt: string;
}

export type HandoffProvenanceT = z.infer<typeof PC.HandoffProvenance>;

/**
 * R7:「转出的结论必须记录 agent + skill 版本 + 数据来源，可回溯」——三者**都**非空
 * 才算"完整"；`skillMounts: []` 或 `dataSources: []` 不是"没有更多来源"的合法值，
 * 是"出处没记全"，必须在这里被挡下而不是被静默接受成一条看似成功的转出。
 */
export function buildHandoffProvenance(
  input: BuildHandoffProvenanceInput,
): { ok: true; provenance: HandoffProvenanceT } | { ok: false; reason: "INCOMPLETE_PROVENANCE" } {
  if (input.skillMounts.length === 0 || input.dataSources.length === 0) {
    return { ok: false, reason: "INCOMPLETE_PROVENANCE" };
  }
  return {
    ok: true,
    provenance: {
      sourceSessionId: input.sourceSessionId,
      agentId: input.agentId,
      agentVersionId: input.agentVersionId,
      skillMounts: [...input.skillMounts],
      dataSources: [...input.dataSources],
      handedOffAt: input.handedOffAt,
    },
  };
}

export interface HandoffTargetThread {
  readonly archived: boolean;
}

export type HandoffOutcome =
  | { readonly ok: true; readonly provenance: HandoffProvenanceT }
  | {
      readonly ok: false;
      readonly reason: "THREAD_ARCHIVED_READONLY" | "INCOMPLETE_PROVENANCE";
      /** E4:「转出被拒并保留私聊内容」——拒绝结果里显式记这一条,不留"内容去哪了"的疑问。 */
      readonly preservedInPrivateChat: true;
    };

/**
 * 完整的转出决策：先校验出处完整，再校验目标线程可写（E4）。
 * ⚠ 顺序：出处不完整时**不应该**因为"反正目标线程也关闭了"而把两个原因合并成一个——
 * 两条独立的拒绝理由分开报告，方便前端各自提示。
 */
export function attemptHandoffToMainThread(
  provenanceInput: BuildHandoffProvenanceInput,
  target: HandoffTargetThread,
): HandoffOutcome {
  const built = buildHandoffProvenance(provenanceInput);
  if (!built.ok) {
    return { ok: false, reason: "INCOMPLETE_PROVENANCE", preservedInPrivateChat: true };
  }
  if (target.archived) {
    return { ok: false, reason: "THREAD_ARCHIVED_READONLY", preservedInPrivateChat: true };
  }
  return { ok: true, provenance: built.provenance };
}

/* ══════════════════════ ⑥ 组员开关：逐场，不跨场继承（O-24 · V15）══════════════════════ */

/**
 * 一个新的"场"（新线程/新项目实例）永远从"关"开始，无论上一场是什么状态——
 * 这个函数**不接受**"上一场的值"作为输入,是"不跨场继承"这条规则本身的证明手段:
 * 不存在一个入参能让它返回除 `false` 以外的东西。
 */
export function defaultMemberToggleForNewSession(): boolean {
  return false;
}

/**
 * 引导师在本场显式开关。返回值只反映"本场刚被设成什么",不读取、不合并任何历史场次的值——
 * 调用方如果想验证"没有继承",应当验证的是:即使传入 `previousThreadToggleEnabled: true`,
 * 一个全新线程在被显式打开之前仍然是 `defaultMemberToggleForNewSession()` 那个恒 false。
 */
export function setMemberToggleForThread(input: {
  readonly threadId: string;
  readonly enabled: boolean;
  readonly setBy: string;
  readonly setAt: string;
}): { readonly threadId: string; readonly enabled: boolean; readonly setBy: string; readonly setAt: string } {
  return { ...input };
}

/* ══════════════════════ ⑦ 项目层归属 + 管理员访问留痕（已裁决 O-24 · V13）══════════════════════ */

export interface AdminPrivateChatReadInput {
  readonly adminId: string;
  readonly sessionId: string;
  readonly projectId: string;
  readonly projectOwnerId: string;
  readonly at: string;
  /**
   * O-04:「不区分管理员是否持有该项目角色」——这个字段存在只是为了让测试能够
   * 断言它对结果没有任何影响,不是这条规则的一个分支条件。
   */
  readonly adminHoldsProjectRole: boolean;
}

/** `provenance.ProvenanceEvent` 的 `admin-project-access` 类型已经就是这件事,不新造枚举成员。 */
export interface AdminPrivateChatAccessAudit {
  readonly type: "admin-project-access";
  readonly actorId: string;
  readonly target: { readonly kind: "thread"; readonly id: string };
  readonly detail: {
    readonly projectId: string;
    readonly visibleToProjectOwner: string;
  };
  readonly at: string;
}

/**
 * 管理员读私聊正文**成功**（私聊归项目层,不是个人层的"只见计数"),但每次访问都产生
 * 一条对项目负责人可见的审计事件——`adminHoldsProjectRole` 传 true 或 false 必须产出
 * 逐字段相同的审计记录（除 `at`/`actorId` 等输入本身携带的字段外),这正是 O-04 的字面意思。
 */
export function recordAdminPrivateChatRead(
  input: AdminPrivateChatReadInput,
): AdminPrivateChatAccessAudit {
  return {
    type: "admin-project-access",
    actorId: input.adminId,
    target: { kind: "thread", id: input.sessionId },
    detail: {
      projectId: input.projectId,
      visibleToProjectOwner: input.projectOwnerId,
    },
    at: input.at,
  };
}
