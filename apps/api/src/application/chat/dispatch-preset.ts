/**
 * `dispatchPreset` —— 下发预设：引导师 → 组长/组员（F115 · uc-8-4 UC-24 · I-40）。
 *
 * ⚠ 三条逐字答死的语义（契约 `dispatchPreset` 注释，原型级别，不是待裁）：
 *   ① 下发方向恒为引导师 → 组长/组员；
 *   ② 下发**不创建任何实例**——`out` 里只有 `targetCount`，没有 `createdInstanceIds`；
 *   ③ 这是「上架供取用」，不是推送——实例只由 `startPresetInstance` 由本人触发。
 *
 * ## 越范围在这一层拒绝，不是下发后失败（I-40）
 *
 * 校验发生在**任何写入之前**：先算好每个引用资源的可见性事实、喂给纯函数
 * `checkPresetDispatchScope`（domain 层的唯一收敛点），它返回拒绝就直接抛错，
 * 一行 `recordDispatch` 都还没执行——这就是「原子性：拒绝时不得已经创建部分实例
 * 或发出部分通知」在代码里的形状（本函数本身就没有创建实例这回事，见上）。
 *
 * ## 已知简化：`visibleToTargets` 目前只回答「存在于组织目录」
 *
 * `checkPresetDispatchScope` 要的是「这个资源对本次下发对象是否可见」，真正的
 * 判定数据来自组织层可见性范围配置（03-skill/04-agent，phase-00 F15）——
 * `feature_list.json` F115 notes 逐字标着这条跨分片依赖「待确认」，本仓目前没有
 * 该配置的实现（同 F110 `org_agents` 占位目录处境一样）。本函数把「存在于
 * `org_agents`/`org_skills` 占位目录」当作现阶段唯一可得的可见性事实，
 * `deniedLayer` 因此恒为 `"organization"`——**这是已登记的简化，不是结论**：
 * F15 落地后，`findOutOfScopeResource` 要换成真正按下发对象算范围的实现，
 * 且需要能产出 `"project"` 层的拒绝（例如「本组专属 skill 下发给别组」）。
 */
import type { OrgId } from "../../domain/org-id";
import { checkPresetDispatchScope, presetTargetsFingerprint } from "../../domain/chat/preset-dispatch-scope";
import type { IdentityRepository } from "../identity/ports";
import type { ChatPresetRepository } from "./ports";

export class NoProjectRoleError extends Error {
  constructor() {
    super("no_project_role");
  }
}
export class PresetNotFoundError extends Error {
  constructor() {
    super("preset_not_found");
  }
}
export class PresetVersionChangedError extends Error {
  constructor() {
    super("version_changed");
  }
}
export class AgentOutOfScopeError extends Error {
  constructor(public readonly resourceId: string) {
    super(`agent_out_of_scope:${resourceId}`);
  }
}
export class SkillOutOfScopeError extends Error {
  constructor(public readonly resourceId: string) {
    super(`skill_out_of_scope:${resourceId}`);
  }
}

export interface DispatchPresetDeps {
  readonly repo: IdentityRepository;
  readonly chatPresets: ChatPresetRepository;
}

export interface DispatchPresetTargets {
  readonly plenary: boolean | null;
  readonly groupIds: readonly string[] | null;
  readonly roles: readonly string[] | null;
}

export interface DispatchPresetInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly presetId: string;
  readonly targets: DispatchPresetTargets;
  /** 调用方对预设当前版本的预期，重放判定的一部分（同 `expectedVersion` 系语义）。 */
  readonly expectedVersion: number | null;
}

export interface DispatchPresetResult {
  readonly dispatchId: string;
  readonly targetCount: number;
}

export async function dispatchPreset(
  deps: DispatchPresetDeps,
  input: DispatchPresetInput,
): Promise<DispatchPresetResult> {
  const membership = await deps.repo.findProjectMembership(input.userId, input.projectId, input.orgId);
  if ((membership?.projectRole ?? null) !== "facilitator") throw new NoProjectRoleError();

  const preset = await deps.chatPresets.findPreset(input.orgId, input.presetId);
  if (preset === null) throw new PresetNotFoundError();
  if (input.expectedVersion !== null && input.expectedVersion !== preset.version) {
    throw new PresetVersionChangedError();
  }

  const targets = {
    plenary: input.targets.plenary ?? false,
    groupIds: input.targets.groupIds ?? [],
    roles: input.targets.roles ?? [],
  };

  // 越范围在这里拒绝，写入之前——见文件头「已知简化」对 visibleToTargets 的说明。
  const outOfScope = await deps.chatPresets.findOutOfScopeResource(
    input.orgId,
    preset.agents,
    preset.skills,
  );
  const decision = checkPresetDispatchScope(
    outOfScope === null
      ? []
      : [{ kind: outOfScope.kind, id: outOfScope.id, visibleToTargets: false, deniedLayer: "organization" }],
  );
  if (!decision.allowed) {
    if (decision.kind === "agent") throw new AgentOutOfScopeError(decision.id);
    throw new SkillOutOfScopeError(decision.id);
  }

  const fingerprint = presetTargetsFingerprint(targets);
  // 幂等重放：同一 (presetId, targets, version) 重复下发返回同一 dispatchId，
  // 不产生第二条下发记录、不重新计数（重新计数在人数变动的场景下会给出不同的
  // targetCount，那就不是「同一次下发」了）。
  const existing = await deps.chatPresets.findExistingDispatch(
    input.orgId,
    input.presetId,
    fingerprint,
    preset.version,
  );
  if (existing !== null) return existing;

  const targetCount = await deps.chatPresets.countDispatchTargets(input.orgId, input.projectId, targets);
  const recorded = await deps.chatPresets.recordDispatch(
    input.orgId,
    input.presetId,
    fingerprint,
    preset.version,
    targetCount,
    targets,
  );
  return recorded;
}
