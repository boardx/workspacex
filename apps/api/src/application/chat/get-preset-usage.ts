/**
 * `getPresetUsage` —— 读预设使用计数（F115 · uc-8-4 UC-26 · I-38）。
 *
 * ⚠ `usageCount` 恒等于**真实实例数**，不按下发人数估算——本函数不做任何计算，
 *   只把 `chatPresets.listPresetInstances` 的结果交给
 *   `domain/chat/preset-usage.ts` 的 `presetUsageCount()`（全仓唯一算它的地方，
 *   同 F110 `agentPanelCounts()` 的纪律）。
 *
 * ## 可见性判定
 *
 * 契约 `getPresetUsage` 的 `pre` 写的是「过 UC-0」，但 UC-0（`resolveVisibility`）
 * 的签名是按**线程**判定的，而预设不是线程——它没有 `threadId` 可过。这里退而
 * 求其次，按「是否为本项目成员」判定（与预设编写/下发要求引导师不同，读用量
 * 对任意项目角色开放，因为契约没有把它限定为引导师专属）。
 * ⚠ 这是本函数对一处契约措辞歧义的具体选择，不是重新发明一套可见性系统。
 */
import type { OrgId } from "../../domain/org-id";
import { presetUsageCount } from "../../domain/chat/preset-usage";
import type { IdentityRepository } from "../identity/ports";
import type { ChatPresetRepository } from "./ports";

export class PresetNotVisibleError extends Error {
  constructor() {
    super("preset_not_visible");
  }
}
export class PresetNotFoundError extends Error {
  constructor() {
    super("preset_not_found");
  }
}

export interface GetPresetUsageDeps {
  readonly repo: IdentityRepository;
  readonly chatPresets: ChatPresetRepository;
}

export interface GetPresetUsageInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly presetId: string;
}

export interface GetPresetUsageResult {
  readonly usageCount: number;
}

export async function getPresetUsage(
  deps: GetPresetUsageDeps,
  input: GetPresetUsageInput,
): Promise<GetPresetUsageResult> {
  const preset = await deps.chatPresets.findPreset(input.orgId, input.presetId);
  if (preset === null) throw new PresetNotFoundError();

  const membership = await deps.repo.findProjectMembership(input.userId, input.projectId, input.orgId);
  if (membership === null) throw new PresetNotVisibleError();

  const instances = await deps.chatPresets.listPresetInstances(input.orgId, input.presetId);
  return { usageCount: presetUsageCount(instances) };
}
