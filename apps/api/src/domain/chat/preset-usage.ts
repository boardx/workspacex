/**
 * F115 —— 预设使用计数 = 真实实例数（chat 束 domain.md I-38，uc-8-4 UC-26）。
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74：本地不跑任何需要 Postgres 的测试）。
 *   与 `domain/chat/agent-presence.ts`（F110）同一个纪律：把「唯一算它的地方」
 *   收进一个纯函数，调用点不得各自再数一遍。
 *
 * ## 为什么不是「下发人数」
 *
 * `usageCount` 刻意不与 `dispatchPreset` 的 `targetCount` 混——契约 `dispatchPreset`
 * 的注释逐字写着「这是上架供取用，不是推送」「下发不创建任何实例」。
 * `usageCount` 只能来自 `startPresetInstance` 真正落下的实例行，下发 10 人、
 * 3 人开始 ⇒ `usageCount === 3`，不是 10。
 *
 * ## 为什么这里还要去重
 *
 * 仓储层用 `UNIQUE (preset_id, started_by)` 保证同一 actor 不会有两行（幂等重放，
 * 见契约 `startPresetInstance` 注释「同一人重复点『开始』返回同一 instanceId」）。
 * 但「使用计数=实例数」这条不变量的断言点不该只信任一张表的唯一约束——
 * 这个函数额外按 actor 去重，使得即便未来某次写路径绕开了约束（例如一次批量导入脚本
 * 忘了走 `startPresetInstance`），计数依然不会被重复行刷高。
 */

/** 使用计数计算所需的最小实例事实。不含 threadId / 时间戳——计数用不到。 */
export interface PresetInstanceRow {
  readonly instanceId: string;
  readonly startedBy: string;
}

/**
 * 按 `startedBy` 去重；同一人若出现多行只算一次（防刷高）。
 * 保留每个 actor **第一次**出现的那一行，与「重复开始返回同一 instanceId」的
 * 幂等语义一致——不是随便丢弃/保留哪一行都行，先出现的那一行才是「原始」的那次。
 */
export function dedupeInstancesByActor(
  instances: readonly PresetInstanceRow[],
): readonly PresetInstanceRow[] {
  const seen = new Map<string, PresetInstanceRow>();
  for (const inst of instances) {
    if (!seen.has(inst.startedBy)) seen.set(inst.startedBy, inst);
  }
  return [...seen.values()];
}

/** I-38 的唯一计算点：`usageCount` 恒等于去重后的真实实例数。 */
export function presetUsageCount(instances: readonly PresetInstanceRow[]): number {
  return dedupeInstancesByActor(instances).length;
}
