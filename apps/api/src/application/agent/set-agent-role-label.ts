/**
 * #1705（#728 D-1，人类裁决见 issue #831 2026-08-09 + 本 issue 2026-08-21 补裁）——
 * 写入 agent 的**简短角色头衔**（`agents.role_label`）。
 *
 * ## ⚠ 范围：只做 `roleLabel` 这一个字段，同 `set-agent-instructions.ts` 一样的纪律
 *
 * `updateAgentDefinition.patch` 有八个字段，本轮只接线这一个（连同已接线的
 * `instructions`，两个）。其余六个字段各自挂着自己未裁的判据（见
 * `set-agent-instructions.ts` 头注），本文件不碰。
 *
 * ## 为什么显式写入会把 `roleLabelNeedsConfirmation` 翻成 false
 *
 * 存量行的占位头衔（迁移回填出来的 `duty`/`role`/`name` 前 8 字）标了
 * `role_label_needs_confirmation = true`——人类还没看过这段文字。admin 一旦通过
 * 这条用例显式写入一个新值，就是「人类看过、确认过」这件事本身，所以这里把标记
 * 翻回 false，而不是留给调用方另外传一个布尔值（那样会给出「我确认了但标记还留着」
 * 这种自相矛盾的状态）。
 */
import type { IdentityRepository } from "../identity/ports";
import { toOrgId } from "../../domain/org-id";

export type SetAgentRoleLabelErrorCode =
  | "ROLE_INSUFFICIENT"
  | "AGENT_NOT_FOUND";

export class SetAgentRoleLabelError extends Error {
  constructor(readonly code: SetAgentRoleLabelErrorCode) {
    super(code);
    this.name = "SetAgentRoleLabelError";
  }
}

export interface SetAgentRoleLabelRepository {
  /**
   * 写入 `agents.role_label`（并把 `role_label_needs_confirmation` 落 false）。
   * 若这一行同时存在于 `capability_listings`（`id = agentId`，已发布），同一次调用
   * 里把投影也更新掉——不留一次「agents 改了、面板还是旧值」的中间态。
   * 返回 false = 该 org 下没有这个 agent。
   */
  setRoleLabel(input: {
    readonly orgId: string;
    readonly agentId: string;
    readonly roleLabel: string;
  }): Promise<boolean>;
}

export const SET_AGENT_ROLE_LABEL_REPOSITORY = Symbol("SetAgentRoleLabelRepository");

export async function setAgentRoleLabel(
  input: {
    readonly orgId: string;
    readonly actorId: string;
    readonly agentId: string;
    readonly roleLabel: string;
  },
  deps: {
    readonly identities: IdentityRepository;
    readonly repository: SetAgentRoleLabelRepository;
  },
): Promise<void> {
  /* ① 授权门，必须最先——同 create-agent.ts / set-agent-instructions.ts 逐字同一条门槛。 */
  const membership = await deps.identities.findOrgMembership(input.actorId, toOrgId(input.orgId));
  if (!membership || membership.orgRole !== "admin") {
    throw new SetAgentRoleLabelError("ROLE_INSUFFICIENT");
  }

  const ok = await deps.repository.setRoleLabel({
    orgId: input.orgId,
    agentId: input.agentId,
    roleLabel: input.roleLabel,
  });
  if (!ok) throw new SetAgentRoleLabelError("AGENT_NOT_FOUND");
}
