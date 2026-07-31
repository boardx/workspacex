/**
 * F115 —— 下发范围校验（chat 束 domain.md I-40，uc-8-4 UC-24）。
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74：本地不跑任何需要 Postgres 的测试）。
 *
 * ## 这个函数不做什么
 *
 * 「某个 agent/skill 对某个下发对象是否可见」的**判定数据**来自组织层配置
 * （03-skill / 04-agent 的可见性范围，phase-00 F15）——`feature_list.json` F115 的
 * notes 逐字标着「跨分片依赖待确认」，那条依赖尚未落地（本仓目前没有
 * `capability/agent` `capability/skill` 的组织层可见性范围实现，同 F110 的
 * `org_agents` 占位目录处境一样，见迁移 0032 文件头）。
 *
 * 这个函数不猜那份数据长什么样，只消费调用方算好的 `visibleToTargets` /
 * `deniedLayer` 事实——与 `resolveVisibility` 消费 phase-00 `authorize()` 算好的
 * `base` 同一个纪律：判定要用的属性由调用方查好传进来，本函数只做**唯一**的
 * 收敛点：「有一个不可见就整体拒绝，且报告第一个不可见的那个」，不在多处各自判一次。
 *
 * ## I-40 的两条硬要求
 *
 * 1. 越范围在**下发接口**即拒绝，不是下发后失败——本函数就是那次拒绝判定本身，
 *    调用方（`application/chat/dispatch-preset.ts`）在写入任何一行之前调用它。
 * 2. 拒绝时不得已经创建部分实例或发出部分通知（原子性）——本函数是纯函数、
 *    无副作用，调用方只在它返回 `allowed:true` 之后才落库，天然满足。
 */

export type PresetResourceKind = "agent" | "skill";

/**
 * 一条资源（agent 或 skill）相对本次下发对象的可见性事实。
 * `visibleToTargets` / `deniedLayer` 由调用方结合组织层 + 项目层配置算好——
 * 本文件不重新实现那份判定（同 `resolveVisibility` 文件头的态度）。
 */
export interface PresetResourceScopeFact {
  readonly kind: PresetResourceKind;
  readonly id: string;
  readonly visibleToTargets: boolean;
  /** 不可见时，是哪一层的限制（错误须标明是组织层还是项目层，I-40）。可见时忽略。 */
  readonly deniedLayer: "organization" | "project";
}

export type PresetDispatchScopeDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly kind: PresetResourceKind;
      readonly id: string;
      readonly deniedLayer: "organization" | "project";
    };

/**
 * 逐条资源过一遍。**遇到第一个不可见的就返回**，不继续收集其余——
 * 契约要的是「拒绝」这个结果与它的定位信息（AGENT_OUT_OF_SCOPE / SKILL_OUT_OF_SCOPE
 * 二选一，加上是哪一层拒的），不是一份完整的违规清单。
 */
export function checkPresetDispatchScope(
  resources: readonly PresetResourceScopeFact[],
): PresetDispatchScopeDecision {
  for (const r of resources) {
    if (!r.visibleToTargets) {
      return { allowed: false, kind: r.kind, id: r.id, deniedLayer: r.deniedLayer };
    }
  }
  return { allowed: true };
}

/** 下发对象——全场 / 指定组 / 指定角色三选一或组合，同契约 `dispatchPreset.in.targets`。 */
export interface PresetDispatchTargets {
  readonly plenary: boolean;
  readonly groupIds: readonly string[];
  readonly roles: readonly string[];
}

/**
 * 下发的幂等指纹（契约注释「同一 (presetId, targets, version) 重复下发返回同一
 * dispatchId」的 `targets` 那一部分）。**顺序无关**：`{groupIds:[a,b]}` 与
 * `{groupIds:[b,a]}` 是同一次下发，排序后再序列化，不然同一语义的两次请求会被
 * 判成两次不同的下发、各自建一行、幂等名存实亡。
 */
export function presetTargetsFingerprint(targets: PresetDispatchTargets): string {
  return JSON.stringify({
    plenary: targets.plenary,
    groupIds: [...targets.groupIds].sort(),
    roles: [...targets.roles].sort(),
  });
}
