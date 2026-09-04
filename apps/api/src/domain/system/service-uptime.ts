/**
 * `service-uptime` —— issue #2645：运营状态屏的中断时长/可用性可视化，纯计算部分。
 *
 * 后台定时 ping 服务（见 `application/system/record-service-uptime-check.ts` 与
 * `infrastructure/system/service-uptime-poll-worker.ts`）写下一条条 `{checkedAt, isUp}`
 * 记录；这里只做一件事：把一批记录折成"红绿 bar 用的分段序列 + 精确可用性百分比"，
 * 不碰 I/O，纯函数，方便直接单测,不用起数据库。
 *
 * ## 为什么百分比允许是 `null`
 *
 * 一个刚上线、还没跑过一次 ping 的部署，`totalChecks === 0`——这时"可用性 100%"和
 * "可用性 0%"都是编造出来的数字，不是"还没有数据"的诚实表达。与本仓库别处
 * （`SystemErrorLogItem.aiSummary` 头注）同一条纪律：没有就是 `null`，不伪造占位值。
 */

export interface UptimeCheckSummary {
  /** ISO 8601。 */
  readonly checkedAt: string;
  readonly isUp: boolean;
}

export interface UptimeAvailability {
  /** 按时间升序（旧→新）——红绿 bar 从左到右画的就是这个顺序。 */
  readonly segments: readonly UptimeCheckSummary[];
  readonly totalChecks: number;
  readonly upChecks: number;
  /**
   * 精确到小数点后两位的百分比（如 99.95），`totalChecks === 0` 时为 `null`。
   * 不是四舍五入到整数——需求原文明确要"确切的可用性百分比"。
   */
  readonly availabilityPercent: number | null;
}

/** `checks` 顺序不敏感——内部先按 `checkedAt` 升序排一次,调用方不必自己保证顺序。 */
export function computeUptimeAvailability(checks: readonly UptimeCheckSummary[]): UptimeAvailability {
  const segments = [...checks].sort((a, b) => a.checkedAt.localeCompare(b.checkedAt));
  const totalChecks = segments.length;
  const upChecks = segments.filter((s) => s.isUp).length;
  const availabilityPercent = totalChecks === 0 ? null : Math.round((upChecks / totalChecks) * 10000) / 100;
  return { segments, totalChecks, upChecks, availabilityPercent };
}
