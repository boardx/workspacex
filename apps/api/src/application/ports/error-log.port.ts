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

export interface ErrorLogPort {
  record(entry: ErrorLogEntry): Promise<void>;
}

export const ERROR_LOG_PORT = Symbol("ErrorLogPort");
