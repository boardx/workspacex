/**
 * 配额与降级的领域派生（F20 / `uc-2-1` R3 步骤 6, R7「模型与配额」, I-21, V11）。
 *
 * 纯函数：没有时钟、没有 I/O。真实的用量计数、消息发送在应用层/网关层
 * （`agent-runtime.routeModelCall`），本文件只回答一个问题：**给定当前用量和策略，
 * 这一次调用该不该降级、该不该显示提示**。
 *
 * ## `hardStop` 为什么不是这里的一个分支
 *
 * 契约 `QuotaPolicy.hardStop` 是 `z.literal(false)`——类型层面就不给「配成 true」
 * 的机会（「现场卡住比多花钱贵」）。所以本文件**没有**任何会让调用中断的返回值：
 * `evaluateQuotaDowngrade` 只回答「降不降级」，从不回答「要不要拒绝这次调用」。
 * 达阈值时的动作永远是「换一个更便宜的模型 + 在对话流里可见提示」，不是拒绝。
 *
 * ## 机密 lane 为什么在这里单独判断，而不是复用 `model-strategy.ts` 的路由判据
 *
 * 「机密材料仅本地」（`model-strategy.ts` 校验的是**能不能选**这个模型）与
 * 「机密材料不被配额降级」（I-21，本文件校验的是**用量达标后还要不要换模型**）
 * 是两条不同的不变量，但结论必须一致：机密 lane 永远不离开本地模型。
 * 这里不重新判定「什么算已启用」，只表达 I-21 逐字的那句「达配额阈值时不得把
 * 机密材料切到非本地模型」——**优先级判断本身**，不涉及模型清单。
 */

import type { ModelLane } from "./model-strategy";

export interface QuotaUsage {
  /** 本场已消耗的 token 数 */
  readonly usedTokens: number;
  /** 单场 token 预算（蓝本级 `QuotaPolicy.perSessionTokenBudget`） */
  readonly perSessionTokenBudget: number;
  /** 触发降级的用量占比（蓝本级 `QuotaPolicy.downgradeAtRatio`，如 0.9） */
  readonly downgradeAtRatio: number;
}

export interface QuotaDowngradeVerdict {
  /**
   * true ⇒ 这次调用该换成更便宜的模型。
   * ⚠ `lane === "confidential"` 时恒为 `false`（I-21）——即使用量已超阈值。
   */
  readonly downgraded: boolean;
  /** 契约锁死的常量，逐字带出，避免调用方另写一个 `false` */
  readonly hardStop: false;
  /**
   * 降级必须在对话流里对引导师可见（V11）：`downgraded === true` 时非空，
   * 否则为 `null`。⚠ 不是「日志里有一条记录」，是要害用户看得到的那句话。
   */
  readonly visibleNotice: string | null;
}

/** 用量是否已达到（或超过）降级阈值。**不看 lane**——纯粹的比例判断。 */
export function quotaThresholdReached(usage: QuotaUsage): boolean {
  if (usage.perSessionTokenBudget <= 0) return false;
  return usage.usedTokens / usage.perSessionTokenBudget >= usage.downgradeAtRatio;
}

/**
 * 给定用量与这次调用所属的 lane，判定该不该降级、该给什么提示。
 *
 * ⚠ 判定顺序：先看 lane 是不是 `confidential`——是就直接放行、不降级，
 * **不先算阈值再覆盖**，避免「先算出该降级、再打补丁改回 false」这种容易漏改的写法。
 */
export function evaluateQuotaDowngrade(usage: QuotaUsage, lane: ModelLane): QuotaDowngradeVerdict {
  if (lane === "confidential") {
    return { downgraded: false, hardStop: false, visibleNotice: null };
  }
  const downgraded = quotaThresholdReached(usage);
  return {
    downgraded,
    hardStop: false,
    // ⚠ 阈值百分比来自 downgradeAtRatio 本身（配置值），不写死「90%」——
    // 蓝本可以配成别的比例，提示文案必须跟着变，否则又是一处会漂移的重复。
    visibleNotice: downgraded
      ? `本场用量已达预算的 ${Math.round(usage.downgradeAtRatio * 100)}%，已自动切换到更经济的模型继续对话（不会中断现场）。`
      : null,
  };
}
