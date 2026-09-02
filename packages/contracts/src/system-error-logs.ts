/**
 * 契约束 `system-error-logs` — ③ API 契约（**唯一事实源**）
 *
 * ADR-020：前后端类型、运行时校验、OpenAPI 的共同来源，任何一样都不许手写第二份。
 *
 * ## 这是什么
 *
 * 自动捕获前端与后端的未处理异常，写入 `error_logs`（已在
 * `apps/api/src/application/ports/error-log.port.ts` 落地的写入面），并给一个
 * **平台超管专用**的只读列表口，供后台「反馈与迭代」屏展示系统异常。
 *
 * ## 为什么读接口限定平台超管，不是组织 admin
 *
 * `error_logs` 故意**没有 `org_id`**（见该表的迁移文件头注：很多异常发生在
 * 租户上下文确定之前，例如登录失败）。把它按组织 admin 权限开一条 HTTP 读口，
 * 等于让**任意一个组织**的管理员看到**全平台所有组织**的异常详情（trace、
 * 请求路径、有时还带内部错误信息片段）——这是一次跨租户数据泄露，不是这条
 * 契约束可以承受的代价。所以读权限判定不是"组织角色"，是一个新的、独立于
 * 组织之外的"平台超管"身份（`NOT_PLATFORM_SUPERUSER`），落在
 * `apps/api/src/interface/controllers/system-error-log.controller.ts`
 * ——白名单来自部署环境变量，不落库、不可由任何组织内的操作授予。
 *
 * ## 前端捕获：`reportClientError` 为什么是 `@Public()`
 *
 * 前端异常（尤其是 React 渲染错误、全局 `error`/`unhandledrejection`）经常发生在
 * 用户**还没登录**、或者登录状态已经损坏的那一刻——这正是最值得被看见的一类异常。
 * 要求鉴权上报，会让"未登录时的白屏"这类异常永远进不了这张表。因此这条写入口
 * 不认证，同时**收窄且脱敏**（见下方字段注释与后端 `redactErrorDetail`）以限制
 * 一个匿名写口的滥用面：不接受结构化 `detail`，只接受几条定长字符串。
 */
import { z } from "zod";

/* ─────────────────────────── 读模型 ─────────────────────────── */

/**
 * 一条系统异常记录。`detail` 是后端 `redactErrorDetail` 处理**之后**的结果——
 * 已经过脱敏（连接串/Bearer/JWT/密钥模式）与长度截断，`unknown` 是它唯一诚实的类型：
 * 这里不重新声明 `{name,message,stack}|{raw}` 那个形状，写库那一侧的端口才是它的
 * 单一事实源（见 `error-log.port.ts` 的 `ErrorLogEntry`）。
 */
export const SystemErrorLogItem = z
  .object({
    id: z.string(),
    traceId: z.string(),
    msg: z.string(),
    detail: z.unknown(),
    createdAt: z.string(),
  })
  .strict();
export type SystemErrorLogItem = z.infer<typeof SystemErrorLogItem>;

/** ⚠ 每一个成员都在下方某个操作的 `err` 里出现——不会被抛出的错误码读起来像覆盖。 */
export const SystemErrorLogError = z.enum([
  /** principal 已认证，但邮箱不在平台超管白名单里。见文件头。 */
  "NOT_PLATFORM_SUPERUSER",
  "DEPENDENCY_UNAVAILABLE",
]);
export type SystemErrorLogError = z.infer<typeof SystemErrorLogError>;

/* ─────────────────────────── 操作 ─────────────────────────── */

export const operations = {
  /**
   * 平台超管专用：按 `id` 倒序读一页系统异常。
   *
   * ⚠ 游标是 `beforeId`（严格小于），不是 `offset`——`error_logs` 持续被写入，
   *   `offset` 分页在这种表上会跳过或重复行；`id` 是 `BIGSERIAL`，单调递增，
   *   天然是一个稳定游标。
   */
  listSystemErrorLogs: {
    method: "GET",
    path: "/system/error-logs",
    in: z
      .object({
        limit: z.number().int().min(1).max(200).optional(),
        beforeId: z.string().optional(),
      })
      .strict(),
    out: z
      .object({
        items: z.array(SystemErrorLogItem),
        /** 还有更早的记录没取——前端"加载更多"按钮据此显隐,不是靠 `items.length`。 */
        hasMore: z.boolean(),
      })
      .strict(),
    err: ["NOT_PLATFORM_SUPERUSER", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 前端异常上报（写入口，`@Public()`，见文件头）。
   *
   * ⚠ 入参是**几条定长字符串**，不是任意 `detail: unknown`——一个匿名、免鉴权的
   *   写口如果接受任意结构化 payload，就是一个没有 schema 约束的攻击面。字段形状
   *   与后端 `errorDetailOf` 派生的 `{name,message,stack}` 对齐，重用同一条
   *   `redactErrorDetail` 脱敏与截断路径,不额外新增一套。
   *
   * ⚠ **每一个字段都有 `.max()`**（review finding，PR #2475）——第一版只给
   *   `message` 定了长度，`stack`/`url`/`userAgent`/`appVersion` 是无界字符串。
   *   写侧的 `redactErrorDetail` 最终会截断，但那发生在请求已经被解析、已经占用
   *   一次连接与一次 INSERT 之后；契约边界的 `.max()` 让**形状不合法的请求在
   *   进入业务逻辑之前就被拒**（400 而不是被悄悄截断后接受），是 ADR-020 说的
   *   "契约是唯一事实源"在这里的直接体现——上限只在这一处声明一次，前端
   *   `lib/report-client-error.ts` 的截断常量与这里逐字对应，不是两份可能漂移的数字。
   *   数值对齐服务端 `redactErrorDetail` 的 `MAX_FIELD_LEN`/`MAX_STACK_LEN`：
   *   `stack` 给到 8000（栈是最长的合法字段），其余给到各自量级合理的上限。
   */
  reportClientError: {
    method: "POST",
    path: "/system/client-error-reports",
    in: z
      .object({
        message: z.string().min(1).max(2000),
        stack: z.string().max(8000).nullable(),
        /** 出错时的路由,复现定位用。不是 `occurredRoute` 那份 I-F1 语义,这里没有租户上下文。 */
        url: z.string().max(2000).nullable(),
        userAgent: z.string().max(500).nullable(),
        appVersion: z.string().max(100).nullable(),
      })
      .strict(),
    out: z.object({ traceId: z.string() }).strict(),
    /** ⚠ 刻意空:写入口 fire-and-forget,失败不应该有前端能感知的错误码可分支。 */
    err: [] as const,
  },
} as const;
