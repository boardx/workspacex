/**
 * F131 (UC-21.1 R3 步骤 3 补 / I-30′) -- 第三方源隔离期：计时、剩余天数、期满转态.
 *
 * ## `quarantineBlocks`（谁能不能调用）不在本文件
 *
 * 那条判定已经在 F53 落在 `authorize-scope.ts`（`quarantineBlocks`），因为它是
 * `authorizeMcpScopeLayer1` 判定顺序第一步的一部分。本文件补三件那条判定不管的事：
 *
 *  1. `computeQuarantineUntil` —— 注册时刻 + 组织参数天数 → 时间戳。**`14` 不落在这里**，
 *     调用方从 `defaultQuarantineDays()`（借用 `THRESHOLDS.mcpQuarantineDays`，
 *     `packages/contracts/src/thresholds.ts` 的单一事实源）或组织覆盖值传入。
 *  2. `quarantineDaysRemaining` —— 界面「隔离期还剩 N 天」的唯一算法。`quarantineUntil`
 *     是时间戳而不是布尔，就是为了能回答这句话；本函数是把时间戳变成这句话里的数字的唯一路径。
 *  3. `reviewStatusOnQuarantineExpiry` —— 期满**不自动开放**：只把「待安全评审」推进
 *     「已到期待复核」；已经被人复核过的结论（`已放行` / `有条件放行` / `维持隔离`）
 *     不因时钟走到期满点而被悄悄改写——人工结论不能被后台任务撤销。
 */
import { THRESHOLDS, requireValue } from "@repo/contracts/thresholds";
import type { ReviewStatus } from "./server-status";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 组织级隔离期天数的默认值。⚠ **不是本文件的常量**——转手引用
 * `THRESHOLDS.mcpQuarantineDays`（有原型出处的默认值，`source = 原型 16,683,800`），
 * 与 `defaultProvenanceRetentionDays` 借用 `AUTH_POLICY.orgRetentionDays` 同一形状。
 * 组织若配置了覆盖值，调用方应传组织参数而不是这个默认值。
 */
export function defaultQuarantineDays(): number {
  return requireValue(THRESHOLDS.mcpQuarantineDays, "mcpQuarantineDays");
}

/**
 * 隔离期截止时刻 = 注册时刻 + 隔离期天数。**纯函数、无 I/O**，`quarantineDays` 是形参，
 * 任何想抄近路写 `+ 14` 的实现都要先假装自己在填这个参数——与 `computeRetentionExpiry`
 * （`customer-data-trace.ts`）同一纪律。
 */
export function computeQuarantineUntil(registeredAt: Date, quarantineDays: number): string {
  if (!Number.isInteger(quarantineDays) || quarantineDays <= 0) {
    throw new Error(`quarantineDays 必须是正整数，收到 ${quarantineDays}`);
  }
  return new Date(registeredAt.getTime() + quarantineDays * DAY_MS).toISOString();
}

/**
 * 「隔离期还剩 N 天」。⚠ 向上取整（哪怕只剩几小时也算「还剩 1 天」，不能显示 0 天却仍在挡调用）；
 * 已过期钳为 `0`（不是负数——负数在界面上没有意义）；`quarantineUntil === null`
 * （非第三方源 / 未进入隔离期）返回 `null`，与「已到期」区分开。
 */
export function quarantineDaysRemaining(quarantineUntil: string | null, now: Date): number | null {
  if (quarantineUntil === null) return null;
  const remainingMs = new Date(quarantineUntil).getTime() - now.getTime();
  if (remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / DAY_MS);
}

/** 到期了没有。`quarantineUntil === null` 恒为 false——它不是"隔离期已经过去"的记法。 */
export function isQuarantineExpired(quarantineUntil: string | null, now: Date): boolean {
  if (quarantineUntil === null) return false;
  return now.getTime() >= new Date(quarantineUntil).getTime();
}

/**
 * 期满时 `reviewStatus` 的转态——且仅有这一种转法。
 *
 * ⚠ **只从 `待安全评审` 转出**：这是"到期了、还没人看过"的那一态，静默停在这里正是
 *   原型要防的事。已经被人工判过的三态（`已放行` / `有条件放行` / `维持隔离`）原样返回——
 *   期满不是一个能撤销人工结论的事件，它只对"从没人看过"这一态生效。
 * ⚠ **绝不产生 `已放行`**——期满只解锁"可以复核"，不解锁"已经放行"，这是 R3 逐字
 *   「期满复核后才对成员开放」的唯一合规读法。
 */
export function reviewStatusOnQuarantineExpiry(input: {
  readonly reviewStatus: ReviewStatus;
  readonly quarantineUntil: string | null;
  readonly now: Date;
}): ReviewStatus {
  if (input.reviewStatus !== "待安全评审") return input.reviewStatus;
  if (!isQuarantineExpired(input.quarantineUntil, input.now)) return input.reviewStatus;
  return "已到期待复核";
}
