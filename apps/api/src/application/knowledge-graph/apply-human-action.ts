/**
 * Phase 18 F10 —— 人对本会话知识的编辑动作（uc-18-3 R3-3 / R3-4，契约 applyHumanAction）。
 *
 * 顺序：会话可见（同读接口，看不见 = 不存在）→ 是会话所有者（R5 / E2）→ 交数据库执行。
 * 数据库那一侧再判一遍所有者、并做版本比对与作用域检查（kg_apply_human_action）。
 * Agent 永远走不到这里：动作的执行身份是登录用户，接口只接受人类会话（I-15）。
 * F16：`resolveConflict`（U-5 矛盾提醒卡的三个出口）同一条路进来，数据库一侧由 kg_resolve_conflict 执行。
 */
import type { KgTodoStatus } from "@repo/contracts/chat-knowledge-graph";
import type { OrgId } from "../../domain/org-id";
import { visibleThread, type KnowledgeReadDeps } from "./read-thread-knowledge";
import { KgHumanActionError, type HumanActionPort, type KgHumanAction } from "./ports";

export interface HumanActionDeps extends KnowledgeReadDeps {
  readonly actions: HumanActionPort;
  readonly newId: (prefix: "act") => string;
}

export async function applyHumanAction(
  deps: HumanActionDeps,
  input: {
    readonly userId: string;
    readonly orgId: OrgId;
    readonly threadId: string;
    readonly basedOnRevision: number;
    readonly action: KgHumanAction;
  },
): Promise<{ readonly revision: number; readonly actionId: string }> {
  const t = await visibleThread(deps, input, input.threadId);
  if (t.facts.createdBy !== input.userId) throw new KgHumanActionError("KG_NOT_OWNER");
  return deps.actions.apply(input.orgId, input.userId, {
    actionId: deps.newId("act"), threadId: input.threadId, basedOnRevision: input.basedOnRevision, action: input.action,
  });
}

/**
 * issue #4363（S6）：改一条待办的状态（open / done / dropped）。人的动作（I-15）：接口层只有人类会话能到这里
 * （actorKind 恒为 human），其余入口一律 agent、拒绝。所有者判定在数据库（kg_set_todo_state）：会话里的 = 会话创建者，
 * 个人空间的 = 空间主人；其余（含看不见）同一个 KG_CLAIM_NOT_FOUND，探测不到别人的记忆。
 * 对话里说「那个做完了」尚未接线：后续由 S4 的改口意图调用这同一个领域操作（未实现）。
 */
export async function setTodoStatus(
  deps: { readonly actions: HumanActionPort; readonly newId: (prefix: "act") => string },
  input: {
    readonly userId: string;
    readonly orgId: OrgId;
    readonly actorKind: "human" | "agent";
    readonly claimId: string;
    readonly status: KgTodoStatus;
  },
): Promise<{ readonly claimId: string; readonly status: KgTodoStatus; readonly claimIds: readonly string[] }> {
  if (input.actorKind !== "human") throw new KgHumanActionError("KG_ACTOR_NOT_HUMAN");
  return deps.actions.setTodoStatus(input.orgId, input.userId, {
    actionId: deps.newId("act"), claimId: input.claimId, status: input.status,
  });
}

