/**
 * `ErrorLogPort` -- a queryable home for the "unhandled exception" bucket of
 * `AllExceptionsFilter`, so a future debugging session can pull a past incident by traceId
 * with one SQL query instead of SSH + `journalctl | grep`.
 *
 * ## Why this is a second sink, not a replacement for `LoggerPort`
 *
 * `ConsoleLogger` stays exactly as it is (structured JSON to stdout, captured by
 * systemd/journald) -- that channel is what `verify-runtime-gates.sh` and every existing
 * assertion about "detail never reaches the response, only the log" (UC-0.6 I-10/I-11)
 * already depend on. This port is additive: the same detail also lands in a queryable table.
 * Two sinks record the same fact once each; neither is a copy of the other's logic (there is
 * no logic here, just a write).
 *
 * ## Why only `AllExceptionsFilter`'s truly-unhandled branch calls this
 *
 * Not every `logger.error(...)` call site in this codebase should also hit Postgres:
 * `ContractValidationError` (400, a caller mistake) and `HttpException` (401/403/404/etc, an
 * expected rejection) are routine, high-volume, and already fully described by their response
 * body -- persisting every one of them would turn ordinary traffic (a wrong password, a stale
 * link) into unbounded write load on a 5-connection pool. The remaining branch -- an exception
 * that is neither of those -- is exactly the "something actually broke" bucket: real
 * incidents, low volume, worth being able to pull later. See the real incident this port was
 * built for: 2026-09-01, traceId 28b6862c-71e1-4ce8-8e3f-3fceb9f8b607 (a raw ioredis error
 * during login, mis-surfaced as `internal_error` -- fixed separately in `login.ts`, but nobody
 * could look up that traceId's detail without deploy-machine SSH access).
 *
 * ## Why a failure to record must never fail the request
 *
 * The thing calling this is already handling the worst case (an unhandled exception). If
 * writing the record itself throws (e.g. the same outage that caused the original error also
 * took Postgres down), the response the user gets must still be `internal_error` -- not a
 * second, different failure caused by the debugging aid. Callers must swallow rejections from
 * `record()`, the same discipline `ConsoleLogger` already has by construction (it can't throw).
 */
export interface ErrorLogEntry {
  readonly traceId: string;
  readonly msg: string;
  /** Same shape `ConsoleLogger` derives from `err` -- name/message/stack, or a raw fallback. */
  readonly detail: unknown;
}

/**
 * A row as `list()` returns it -- already through `redactErrorDetail` (it went through that
 * on the way IN, at `record()` time; `list()` reads back exactly what was stored, it does not
 * redact a second time). `detail` stays `unknown` for the same reason `ErrorLogEntry.detail`
 * is `unknown`: this port does not assume the `{name,message,stack}|{raw}` shape, only that
 * whatever is there already passed through the one sanitiser.
 */
export interface ErrorLogListItem {
  readonly id: string;
  readonly traceId: string;
  readonly msg: string;
  readonly detail: unknown;
  readonly createdAt: string;
  /**
   * AI 生成的一句话标题/一段面向人类的说明（人类 2026-09-02 要求：系统异常要跟反馈
   * 卡片一样有段给人看的文字，供人类决定怎么处理，不是原始异常字段）——
   * `PgErrorLogWriter.record()` 落库后异步生成，见 `application/system/summarize-error-log.ts`。
   * `null` ⟺ 还没生成完 / 这次没生成出来（模型不可用、超时、部署没配模型）——**不是**
   * "这条异常没有摘要"这件事本身是错的，界面必须能把"还没有"和"生成失败"都说出来，
   * 而不是伪造一段占位摘要。
   */
  readonly aiTitle: string | null;
  readonly aiSummary: string | null;
  /**
   * 生命周期状态（2026-09-03 人类要求，见迁移 `20260903120000_error_logs_lifecycle_tags.sql`
   * 头注）：`待处理` / `已转入开发` / `不做`（存档）。`statusReason` 只在转「不做」时
   * 必填，其余转移可以留空；`devNote` 是"转开发"时人类可以填的说明字段，不绑定于
   * 某一次特定转移，随时可编辑。`tags` 是自由文本标签，供筛选/搜索。
   */
  readonly status: ErrorLogStatus;
  readonly statusReason: string | null;
  readonly devNote: string | null;
  readonly tags: readonly string[];
}

/** 见 `ErrorLogListItem.status` 头注；与迁移里的 CHECK 约束逐字对应。 */
export type ErrorLogStatus = "待处理" | "已转入开发" | "不做";

export interface ErrorLogPort {
  record(entry: ErrorLogEntry): Promise<void>;

  /**
   * Newest-first page, by `id` cursor (see `system-error-logs.ts`'s `listSystemErrorLogs` for
   * why `beforeId` rather than `offset`). `list()` has its own authorization story:
   * `error_logs` has no `org_id`, so nothing here is tenant-scoped -- the caller
   * (`SystemErrorLogController`) is the one and only place that decides who may call this,
   * via the platform-superuser whitelist, BEFORE this method is ever reached.
   */
  list(input: { readonly limit: number; readonly beforeId: string | null }): Promise<{
    readonly items: readonly ErrorLogListItem[];
    readonly hasMore: boolean;
  }>;

  /**
   * 校验转移合法性、合并局部更新用的窄口径读取——生命周期四列，见
   * `kernel_read_error_log_lifecycle`。`null` ⟺ 这个 id 不存在。
   */
  getLifecycle(id: string): Promise<{
    readonly status: ErrorLogStatus;
    readonly statusReason: string | null;
    readonly devNote: string | null;
    readonly tags: readonly string[];
  } | null>;

  /** 生命周期（状态/理由/开发备注/标签）的唯一写入口，见 `kernel_write_error_log_lifecycle`。 */
  updateLifecycle(id: string, next: {
    readonly status: ErrorLogStatus;
    readonly statusReason: string | null;
    readonly devNote: string | null;
    readonly tags: readonly string[];
  }): Promise<void>;
}

export const ERROR_LOG_PORT = Symbol("ErrorLogPort");

/**
 * `redactErrorDetail` -- the ONE sanitiser every write to `error_logs` goes through, applied
 * inside `PgErrorLogWriter.record()` (not left to callers to remember).
 *
 * ## Why this exists (2026-09-01 review finding #1, PR #2444)
 *
 * `ConsoleLogger`'s own file header says it plainly: "`err.message` routinely contains SQL
 * fragments and table names". That was an acceptable risk for stdout captured by journald,
 * reachable only by SSH onto the specific deploy box. A queryable Postgres table with a
 * 30-day retention window is a materially different blast radius -- easier to bulk-export,
 * reachable by anything holding the app's DB credentials, not scoped to one machine's
 * operator. So the exact same raw detail that is fine to journal is not automatically fine
 * to archive, and this function is the boundary that makes the distinction real instead of
 * asserted.
 *
 * ## What it does: bound, then scrub, both mechanically testable
 *
 * 1. **Size bounds** -- `message`/`raw` capped at `MAX_FIELD_LEN`, `stack` at
 *    `MAX_STACK_LEN`, each truncated with a visible marker so a truncated record never reads
 *    as a complete one. This is what answers "oversized input" in the finding: nothing this
 *    function returns can make an INSERT unboundedly large, regardless of what the thrown
 *    value contained.
 * 2. **Pattern-based scrubbing** -- run over every string field, replacing the shapes credentials
 *    most commonly take in a stack trace or error message: connection-string URLs with
 *    embedded userinfo (`postgres://user:pass@host`, `redis://...`), `Authorization: Bearer
 *    <token>` headers, JWT-shaped triples, and `key = value` pairs where the key looks like a
 *    secret (`password`, `token`, `secret`, `api_key`, ...). None of these patterns claim to
 *    be exhaustive -- no regex-based scrubber is -- but they cover the shapes this codebase's
 *    own infrastructure actually produces (Postgres/Redis DSNs, bearer session tokens, JWTs),
 *    which is the concrete risk the finding named, not a claim of universal coverage.
 *
 * ## Why bound+scrub happens on the WRITE side, not by changing what `errorDetailOf` returns
 *
 * `errorDetailOf` (`logger.port.ts`) stays exactly as it is: `ConsoleLogger` must keep
 * getting the full, unredacted detail (that channel's whole job is being complete for a human
 * with SSH access mid-incident). Redaction is specific to the second, wider-reach sink, so it
 * belongs on that sink's write path, not upstream where it would quietly weaken the log too.
 */
const MAX_FIELD_LEN = 2_000;
const MAX_STACK_LEN = 8_000;
const TRUNCATED_SUFFIX = "…[TRUNCATED]";

const SECRET_PATTERNS: readonly RegExp[] = [
  // Connection-string URLs with embedded userinfo (postgres://, postgresql://, redis://,
  // rediss://, mongodb://, mysql://, amqp(s)://) -- redact the WHOLE url, not just the
  // credential portion: host/port/db-name after a real DSN is still infrastructure detail
  // this table should not be casually holding either.
  /\b(postgres(?:ql)?|redis|rediss|mongodb(?:\+srv)?|mysql|amqps?):\/\/[^\s'")]+/gi,
  // `Authorization: Bearer <token>` / a bare `Bearer <token>` in a message.
  /\bBearer\s+[A-Za-z0-9\-_.]+/g,
  // JWT-shaped triples (header.payload.signature, base64url segments).
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{2,}/g,
  // `key = value` / `key: value` / `key="value"` where the key name looks like a secret.
  /\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)\s*[:=]\s*["']?[^\s"',;]+["']?/gi,
];

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - TRUNCATED_SUFFIX.length) + TRUNCATED_SUFFIX;
}

function scrub(s: string): string {
  let out = s;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[REDACTED]");
  return out;
}

/** Applied to every string field before it can enter `error_logs`. Order matters: scrub the
 *  full string first (so a secret is not half-truncated into something unrecognisable but
 *  still partially readable), then bound its length. */
function sanitiseField(s: string, max: number): string {
  return truncate(scrub(s), max);
}

/**
 * `detail` is `unknown` by the port's own contract (see `ErrorLogEntry`) -- this function
 * does not assume it is the `{name,message,stack}|{raw}` shape `errorDetailOf` produces
 * (a non-Error/cyclic/exotic thrown value is exactly what the finding asks to be proven
 * safe). Anything that is not a plain string field on a plain object is stringified through
 * `String(...)` and then run through the same scrub+bound path -- never through
 * `JSON.stringify` on an arbitrary object, which is how a cyclic reference would throw.
 */
export function redactErrorDetail(detail: unknown): unknown {
  if (detail === null || typeof detail !== "object" || Array.isArray(detail)) {
    return { raw: sanitiseField(String(detail), MAX_FIELD_LEN) };
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (typeof value !== "string") {
      // Not a string field this function knows how to scrub (e.g. an unexpected nested
      // object) -- stringify defensively rather than let it flow through unexamined. This is
      // also what makes a cyclic value here safe: `String(...)` on an object never recurses
      // into cycles the way `JSON.stringify` would.
      out[key] = sanitiseField(String(value), MAX_FIELD_LEN);
      continue;
    }
    out[key] = sanitiseField(value, key === "stack" ? MAX_STACK_LEN : MAX_FIELD_LEN);
  }
  return out;
}

/**
 * `redactErrorMessage` -- 同一套 scrub+bound，套在 `msg` 这个字符串字段上（2026-09-03，
 * 独立评审 finding #2）。
 *
 * `msg` 本身落库时**不**经过这条函数（`error_logs.msg` 列历来存的是调用方传入的原样字符串
 * ——`SystemErrorLogController.report()` 那条分支甚至直接来自客户端上报文本，见该文件；
 * 这是既有事实，不在本次改动范围内，动它会改变一张已经在生产的表历史上一直存的内容形状）。
 *
 * 但 `summarize-error-log.ts` 把 `msg` 发给外部模型，是**新增的一条分发路径**——多一个
 * 消费者不能拿"反正已经落库了"当理由。调用方（`PgErrorLogWriter`）在喂给模型前必须过一次
 * 这个函数，就像 `detail` 必须先过 `redactErrorDetail` 一样，两条路径分别脱敏、互不依赖。
 */
export function redactErrorMessage(msg: string): string {
  return sanitiseField(msg, MAX_FIELD_LEN);
}
