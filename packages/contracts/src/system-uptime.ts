/**
 * 契约束 `system-uptime` — ③ API 契约（**唯一事实源**），issue #2645。
 *
 * ## 这是什么
 *
 * 运营状态屏的「服务中断时长与可用性可视化」：后台定时 worker ping 一个探活目标
 * （默认是 Dev app,见 `apps/api/src/infrastructure/system/service-uptime-config.ts`
 * 的 `DEV_APP_UPTIME_URL`），把结果落库；这条只读接口把最近若干次探活折成
 * "红绿 bar 用的分段序列 + 精确可用性百分比"给前端画。
 *
 * ## 为什么限定平台运营（`PlatformOperatorGuard`），不是组织 admin
 *
 * 与 `system-error-logs.ts` 同一个理由：这是基础设施自我观测,没有 `org_id`,
 * 不属于任何一个租户——按组织角色开放,等于让某一个组织的管理员看到"整个部署"
 * 是否在中断这件与它无关的事,边界不对。
 */
import { z } from "zod";

/** 一次探活结果——最细粒度的原始记录。 */
export const UptimeCheckSegment = z
  .object({
    checkedAt: z.string(),
    isUp: z.boolean(),
  })
  .strict();
export type UptimeCheckSegment = z.infer<typeof UptimeCheckSegment>;

/**
 * 红绿 bar 的一格 = 一个固定时长的桶（2026-09-14：窗口拉到 24 小时后，1440 次探活
 * 一格一次画不下，也看不出"什么时候断的"）。桶按窗口等分，`status`：
 *   `up`      桶内全部探活可用；
 *   `down`    桶内至少一次中断（中断以"任意一次"为准，不做多数表决——运维要看的
 *             是"这段时间出过事没有"，不是平均值）；
 *   `no_data` 桶内没有探活记录（worker 还没跑到 / API 自己停过——本身就是一种信号，
 *             用灰色画，不冒充绿）。
 */
export const UptimeBucket = z
  .object({
    from: z.string(),
    to: z.string(),
    checks: z.number().int().min(0),
    downChecks: z.number().int().min(0),
    status: z.enum(["up", "down", "no_data"]),
  })
  .strict();
export type UptimeBucket = z.infer<typeof UptimeBucket>;

export const SystemUptimeError = z.enum(["NOT_PLATFORM_SUPERUSER"]);
export type SystemUptimeError = z.infer<typeof SystemUptimeError>;

export const operations = {
  /**
   * 平台运营专用：最近 `windowHours` 小时（当前固定 24）的探活记录折成 `buckets`
   * （等分成 `bucketMinutes` 一格的红绿灰 bar）+ 窗口内精确可用性百分比。
   * `target` 是实际探活的 URL（配置来源见 `service-uptime-config.ts`：显式
   * `DEV_APP_UPTIME_URL`，否则回退到本部署的 `APP_PUBLIC_URL`），`configured: false` 时为 `null`。
   *
   * `configured: false` ⟺ 这个部署既没配 `DEV_APP_UPTIME_URL` 也没有 `APP_PUBLIC_URL`——前端据此渲染
   * "未配置探活目标",不是把"没有数据"的空 bar 当成"100% 可用"或"0% 可用"来画。
   * `availabilityPercent` 在 `totalChecks === 0` 时是 `null`（还没有任何一次探活
   * 记录——即使 `configured: true`,worker 刚启动、第一次探活还没跑完时会短暂出现
   * 这个态），不伪造一个数字。
   */
  getServiceUptimeStatus: {
    method: "GET",
    path: "/system/uptime",
    in: z.object({}).strict(),
    out: z
      .object({
        service: z.string(),
        configured: z.boolean(),
        target: z.string().nullable(),
        windowHours: z.number().int().positive(),
        bucketMinutes: z.number().int().positive(),
        buckets: z.array(UptimeBucket),
        totalChecks: z.number().int().min(0),
        upChecks: z.number().int().min(0),
        availabilityPercent: z.number().min(0).max(100).nullable(),
      })
      .strict(),
    err: ["NOT_PLATFORM_SUPERUSER"] as const,
  },
} as const;
