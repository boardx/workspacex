/**
 * AG01（契约束 agent-role UC-1，requirements 03-agent-role.md R3/R5）—— 草稿角色字段编辑的判定。
 *
 * 纯函数：官方目录 Agent 的角色字段锁定（R5：组织管理员须克隆后改）、乐观并发号、
 * 合并后整体仍须满足契约 `AgentRoleFields`。`catalogSource` 不在 patch 里（契约 `.omit`），
 * 所以合并永远保留原值——本函数不接受也不产出目录来源的变化。
 */
import { agentRole as R } from "@repo/contracts";
import type { AgentRoleFieldsT } from "./definition";

export type RoleDraftPatch = Partial<Omit<AgentRoleFieldsT, "catalogSource">>;

export type RoleDraftDecision =
  | { readonly ok: true; readonly fields: AgentRoleFieldsT }
  | { readonly ok: false; readonly reason: "OFFICIAL_ROLE_FIELDS_LOCKED" | "VERSION_CHANGED" | "VALIDATION_FAILED" };

export function decideRoleDraftPatch(
  current: { readonly fields: AgentRoleFieldsT; readonly version: number },
  expectedVersion: number,
  patch: RoleDraftPatch,
): RoleDraftDecision {
  // 锁先于并发号：官方 Agent 无论版本号对不对都不可改，答「版本变了」会诱导重试。
  if (current.fields.catalogSource === "official") return { ok: false, reason: "OFFICIAL_ROLE_FIELDS_LOCKED" };
  if (current.version !== expectedVersion) return { ok: false, reason: "VERSION_CHANGED" };
  if ("catalogSource" in patch) return { ok: false, reason: "VALIDATION_FAILED" };
  const merged = R.AgentRoleFields.safeParse({ ...current.fields, ...patch });
  if (!merged.success) return { ok: false, reason: "VALIDATION_FAILED" };
  return { ok: true, fields: merged.data };
}

/** 契约 `AgentRoleAdminView.editable`：official ⇒ false。 */
export function isRoleEditable(fields: AgentRoleFieldsT): boolean {
  return fields.catalogSource !== "official";
}
