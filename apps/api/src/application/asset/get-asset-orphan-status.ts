/**
 * `GetAssetOrphanStatus` (F140) -- `uc-23-6` R7 规则 7 + E1 的表达面, domain I-14.
 *
 * 🔴 **只表达 E1，不裁决兜底接管人**（E1 `[待确认]`，见 `uc-23-6` 本文原句：「必须有一个兜底
 * 接管人（候选：平台组管理员 / 组织管理员）→ `[待确认]`」）。这个函数回答的是「这份资产现在
 * 是否处于降级 + 负责人已停用的态」，`takeoverEntryPoint: true` 只声明「界面应该露出一个入口」
 * 这一个布尔事实——入口背后按什么规则接管，是人类要裁的 Q，本函数不发明。
 *
 * ⚠ **不是惰性判定**：与 F138/F139 的其它一切一样，这只是一次读——它不改变任何状态，
 *   也不依赖调用时机（不像 R7 规则 7 反面那句「谁都看不到」本身需要主动扫描去修复，
 *   本函数只是把「已经发生的降级 + 已经发生的账号停用」这两个既成事实读出来并组合判断）。
 */
import type { AssetGovernanceRepository, AssetKind, AssetOwnerStatusPort, ReviewClockRepository } from "./ports";

export interface GetAssetOrphanStatusResult {
  readonly orphaned: boolean;
  /** `null` unless `orphaned` -- mirrors `ReviewClock.downgradeDueAt`'s "only meaningful in one state" shape. */
  readonly code: "ASSET_DOWNGRADED_OWNER_MISSING" | null;
  /** ⚠ 只声明入口应可见，不实现入口背后的接管流程（E1 `[待确认]`）。 */
  readonly takeoverEntryPoint: boolean;
}

export interface GetAssetOrphanStatusDeps {
  readonly reviewClocks: ReviewClockRepository;
  readonly governance: AssetGovernanceRepository;
  readonly ownerStatus: AssetOwnerStatusPort;
}

export interface GetAssetOrphanStatusInput {
  readonly assetKind: AssetKind;
  readonly assetId: string;
}

const NOT_ORPHANED: GetAssetOrphanStatusResult = { orphaned: false, code: null, takeoverEntryPoint: false };

export async function getAssetOrphanStatus(
  deps: GetAssetOrphanStatusDeps,
  input: GetAssetOrphanStatusInput,
): Promise<GetAssetOrphanStatusResult> {
  const clock = await deps.reviewClocks.get(input.assetKind, input.assetId);
  if (clock === null || clock.state !== "downgraded") return NOT_ORPHANED;

  const governance = await deps.governance.get(input.assetKind, input.assetId);
  // No governance on record for a downgraded clock should not happen (mirrors scan-review-clocks'
  // own reasoning) -- treat as "nothing to report" rather than fabricating an owner-missing verdict.
  if (governance === null) return NOT_ORPHANED;

  const deactivated = await deps.ownerStatus.isOwnerDeactivated(governance.ownerId);
  if (!deactivated) return NOT_ORPHANED;

  return { orphaned: true, code: "ASSET_DOWNGRADED_OWNER_MISSING", takeoverEntryPoint: true };
}
