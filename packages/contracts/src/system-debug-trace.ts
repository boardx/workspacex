/**
 * 契约束 `system-debug-trace` — ③ API 契约（**唯一事实源**）
 *
 * ## 这是什么（issue #3082，源自 #2873 的复盘）
 *
 * 后台 **debug recorder**：API 进程把「每个 HTTP 请求的结果」「卡住超过阈值的请求」
 * 「未处理异常」「业务代码显式打的诊断点」统一记成结构化事件，带 `traceId` 串联，
 * 落到 `debug_events` 表；这里是 agent / 平台运营读回它们的只读口。
 *
 * 与 `system-error-logs` 的关系：`error_logs` 只记「炸了」那一刻；这里记的是**炸之前
 * 和炸周围发生了什么**（同一个 traceId 下的请求、耗时、上下游调用、卡住的请求）——
 * 定位一次假死或超时，缺的正是这些。两者互补，不互相替代。
 *
 * ## 读权限为什么是平台运营准入（`PlatformOperatorGuard`），不是组织 admin
 *
 * 同 `error_logs`：这张表没有 `org_id`（很多事件发生在租户上下文之前），按组织角色
 * 开放等于让任意组织的管理员看到全平台的请求流水。
 */
import { z } from "zod";

/** 事件级别——`error` 是出错，`warn` 是「可疑」（慢/卡住/降级），`info` 是正常流水。 */
export const DebugEventLevel = z.enum(["info", "warn", "error"]);
export type DebugEventLevel = z.infer<typeof DebugEventLevel>;

/**
 * 一条诊断事件。`kind` 是点号分隔的开放字符串（`http.request` / `http.request.stalled` /
 * `exception.unhandled` / `agent_run.*` …）——开放是因为业务代码可以随时加新点，
 * 收敛的是 `level` 与 `data` 的脱敏规则（服务端 `redactDebugData`），不是 kind 的取值。
 */
export const DebugEventItem = z
  .object({
    id: z.string(),
    /** 串联同一条链路的键——HTTP 请求的 `x-trace-id`，后台任务可用 runId 等自定义值。 */
    traceId: z.string(),
    kind: z.string(),
    level: DebugEventLevel,
    /** 给人/agent 看的一句话。 */
    msg: z.string(),
    /** 结构化附加数据，已脱敏 + 截断；形状由 kind 决定，这里不重复声明。 */
    data: z.unknown(),
    /** 事件耗时（若适用），毫秒。 */
    durationMs: z.number().nullable(),
    userId: z.string().nullable(),
    orgId: z.string().nullable(),
    createdAt: z.string(),
  })
  .strict();
export type DebugEventItem = z.infer<typeof DebugEventItem>;

/** 记录器自身的运行状态——它是不是在丢事件、DB 写是不是在失败，本身就是排障线索。 */
export const DebugRecorderStatus = z
  .object({
    enabled: z.boolean(),
    /** 内存环形缓冲里还没落库的事件数。 */
    buffered: z.number().int(),
    /** 累计已成功落库的事件数。 */
    flushed: z.number().int(),
    /** 累计因为缓冲溢出被丢弃的事件数。 */
    dropped: z.number().int(),
    /** 累计落库失败的批次数。 */
    flushFailures: z.number().int(),
    /** 最近一次落库失败的（脱敏后）错误文本；null = 从没失败过。 */
    lastFlushError: z.string().nullable(),
    /** 最近一次成功落库的时间；null = 还没落过。 */
    lastFlushAt: z.string().nullable(),
    /** 当前仍在飞行中（还没结束）的 HTTP 请求。 */
    inFlightRequests: z.array(
      z.object({
        traceId: z.string(),
        method: z.string(),
        path: z.string(),
        ageMs: z.number(),
      }),
    ),
  })
  .strict();
export type DebugRecorderStatus = z.infer<typeof DebugRecorderStatus>;

export const operations = {
  /**
   * 按条件倒序读一页事件。`beforeId` 游标（严格小于），同 `listSystemErrorLogs` 的理由。
   * `source=memory` 读进程内环形缓冲（DB 挂了也能看最近的事件），默认读库。
   */
  listDebugEvents: {
    method: "GET",
    path: "/system/debug/events",
    in: z
      .object({
        traceId: z.string().optional(),
        kind: z.string().optional(),
        level: DebugEventLevel.optional(),
        /** ISO 时间，含。 */
        since: z.string().optional(),
        /** ISO 时间，含。 */
        until: z.string().optional(),
        /** 对 `msg` 做子串匹配（大小写不敏感）。 */
        q: z.string().optional(),
        userId: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
        beforeId: z.string().optional(),
        source: z.enum(["db", "memory"]).optional(),
      })
      .strict(),
    out: z.object({ items: z.array(DebugEventItem), hasMore: z.boolean() }).strict(),
    err: ["NOT_PLATFORM_SUPERUSER", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** 一条链路的全部事件，按时间正序——「这个 traceId 到底经历了什么」的一次性答案。 */
  getDebugTrace: {
    method: "GET",
    path: "/system/debug/traces/:traceId",
    in: z.object({ traceId: z.string().min(1) }).strict(),
    out: z.object({ traceId: z.string(), items: z.array(DebugEventItem) }).strict(),
    err: ["NOT_PLATFORM_SUPERUSER", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** 记录器自身状态 + 飞行中的请求。 */
  getDebugRecorderStatus: {
    method: "GET",
    path: "/system/debug/status",
    in: z.object({}).strict(),
    out: DebugRecorderStatus,
    err: ["NOT_PLATFORM_SUPERUSER"] as const,
  },
} as const;
