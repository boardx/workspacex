/**
 * Phase 18 F10 —— 人对本会话知识的编辑动作（uc-18-3 R3-3 / R3-4，契约 applyHumanAction）。
 *
 * 顺序：会话可见（同读接口，看不见 = 不存在）→ 是会话所有者（R5 / E2）→ 交数据库执行。
 * 数据库那一侧再判一遍所有者、并做版本比对与作用域检查（kg_apply_human_action）。
 * Agent 永远走不到这里：动作的执行身份是登录用户，接口只接受人类会话（I-15）。
 * F16：`resolveConflict`（U-5 矛盾提醒卡的三个出口）同一条路进来，数据库一侧由 kg_resolve_conflict 执行。
 */
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

