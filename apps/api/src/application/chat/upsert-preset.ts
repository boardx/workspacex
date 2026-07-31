/**
 * `upsertPreset` —— 创建 / 编辑预设（F115 · uc-8-4 UC-23）。
 *
 * ⚠ **I-41 两条禁止项由契约形状担保，不是本函数里的一个 if**：`upsertPreset.in`
 *   是 `.strict()` 的 zod schema，只有 `openingPrompt` / `skills` / `agents` 三个
 *   字段——没有任何「预先批准某个高影响动作」或「绕过权限/同意位的检索范围」的
 *   输入位可填。`PRESET_PREAPPROVAL_FORBIDDEN` / `PRESET_SCOPE_BYPASS_FORBIDDEN`
 *   两个错误码因此**目前结构性不可达**：这是刻意的，不是遗漏。等预设真正支持
 *   任何「预配置动作」的输入位时（例如允许预设携带一个批准模板），这两个检查
 *   必须长在那个新输入位旁边，而不是在这里猜一个假字段去挡一个不存在的攻击面。
 *   ZodBodyPipe 的 `.strict()` 校验发生在 interface 层，本函数不重复那一遍。
 *
 * ## 只有引导师能编写预设
 *
 * 契约 `err` 只列了 `NO_PROJECT_ROLE`（没有 `NO_WRITE_ROLE`），与 `mutateThread`
 * 的「观察者也好、组员也好，只要不是引导师就拒」不同——预设编写是**引导师专属**
 * 动作（domain.md UC-23 `pre: 引导师`），不是「任意有写权限的角色」。
 */
import type { OrgId } from "../../domain/org-id";
import type { IdFactory } from "../artifact/ports";
import type { IdentityRepository } from "../identity/ports";
import type { ChatPresetRepository } from "./ports";

export class NoProjectRoleError extends Error {
  constructor() {
    super("no_project_role");
  }
}
export class PresetVersionChangedError extends Error {
  constructor() {
    super("version_changed");
  }
}

export interface UpsertPresetDeps {
  readonly repo: IdentityRepository;
  readonly chatPresets: ChatPresetRepository;
  readonly presetIds: IdFactory;
}

export interface UpsertPresetInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly presetId: string | null;
  readonly openingPrompt: string;
  readonly skills: readonly string[];
  readonly agents: readonly string[];
  readonly expectedVersion: number | null;
}

export interface UpsertPresetResult {
  readonly presetId: string;
  readonly version: number;
}

export async function upsertPreset(
  deps: UpsertPresetDeps,
  input: UpsertPresetInput,
): Promise<UpsertPresetResult> {
  const membership = await deps.repo.findProjectMembership(input.userId, input.projectId, input.orgId);
  // uc-8-4 UC-23 `pre: 引导师`——不是「任意持有写权限的角色」，与 `mutateThread` 的
  // 「观察者除外都行」是两条不同的前置，不合并成一套「谁能写」判断。
  if ((membership?.projectRole ?? null) !== "facilitator") throw new NoProjectRoleError();

  const isNew = input.presetId === null;
  const presetId = input.presetId ?? deps.presetIds.next("preset");
  const outcome = await deps.chatPresets.upsertPreset(input.orgId, input.projectId, {
    presetId,
    isNew,
    openingPrompt: input.openingPrompt,
    skills: input.skills,
    agents: input.agents,
    expectedVersion: input.expectedVersion,
    createdBy: input.userId,
  });
  if (outcome.kind === "version-changed") throw new PresetVersionChangedError();
  return { presetId: outcome.presetId, version: outcome.version };
}
