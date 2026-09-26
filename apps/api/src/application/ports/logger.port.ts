/**
 * Logger port.
 *
 * This exists not for elegance but because the error boundary requires that detail
 * goes to logs and never to the response (UC-0.6 I-10). The two channels must be
 * separately testable: whatever must not appear in the response must appear in the
 * log, correlated by the same traceId (I-11). Otherwise "only return internal_error"
 * trades security for unoperability.
 */
export interface LogFields {
  readonly traceId: string;
  readonly [k: string]: unknown;
}

export interface LoggerPort {
  info(msg: string, fields: LogFields): void;
  /** Full error detail (including stack) stops here */
  error(msg: string, fields: LogFields & { err: unknown }): void;
  /** For tests: entries recorded so far. Implementations may keep them only in check mode. */
  drain?(): readonly { msg: string; fields: LogFields }[];
}

export const LOGGER_PORT = Symbol("LoggerPort");

/**
 * The `err` -> loggable-detail derivation, factored out so `ConsoleLogger` and
 * `PgErrorLogWriter` (via `AllExceptionsFilter`) record the identical shape instead of each
 * re-deriving it -- the same fact stated twice is how the two sinks drift apart.
 */
export function errorDetailOf(
  err: unknown,
): { name: string; message: string; stack: string | undefined } | { raw: string } | Record<string, unknown> {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  /*
   * ⚠ 普通对象**原样透出**，不要 `String(err)`（2026-09-25 真实模型实测）。
   *
   * 这里此前只分两路：Error 或 `String(err)`。而应用层的失败详情常常是一个结构化对象
   * （`{ attempt, exitCode, stderrExcerpt }`），`String(它)` 就是 `"[object Object]"`——
   * 落库的 detail 变成 `{ raw: "[object Object]" }`，19 次脚本报错**一条 stderr 都没留下**。
   *
   * 这是同一条链上的第二个丢信息点（第一个在 `structuredErrorLog`，见其头注）。
   * 透出之后由两个 sink 各自的 `redactErrorDetail` 逐字段脱敏+截断——
   * 那个函数本来就是按「普通对象的字符串字段」设计的，这里不做第二遍处理。
   */
  if (err !== null && typeof err === "object" && !Array.isArray(err)) return err as Record<string, unknown>;
  return { raw: String(err) };
}

/**
 * 把「(message, detail) 两参的应用层 log」接到 `LoggerPort.error` 上的**唯一一份**适配器。
 *
 * ## 它修的是什么（2026-09-25 真实模型实测）
 *
 * 此前这段在 6 处各写了一遍，且都是
 * `err: detail.detail ?? message`。应用层传的是**结构化字段**（如
 * `{ attempt, exitCode, stderrExcerpt }`），它没有 `.detail` 这个键，于是整包退化成
 * 消息字符串本身——落库的 `detail` 变成 `{ raw: "skill trial run script attempt failed" }`。
 *
 * 后果在真实模型十任务矩阵上量到了：**19 次脚本执行失败，一条 stderr 原文都没留下**。
 * 排查的人（以及写这段注释的 agent 自己）只能看到「失败了」，看不到「为什么」。
 * 这正是本仓反复强调的「失败必须带回真因」在日志层的漏洞。
 *
 * 优先级：调用方显式给的 `err` / `detail` 最优先；都没有时用**整包结构化字段**，
 * 而不是退回消息本身——消息在 `msg` 列里已经有了，把它再抄进 detail 等于什么都没记。
 */
export function structuredErrorLog(
  logger: Pick<LoggerPort, "error">,
  traceId: () => string,
): (message: string, detail: Record<string, unknown>) => void {
  return (message, detail) => {
    const err = detail.err ?? detail.detail ?? (Object.keys(detail).length > 0 ? detail : message);
    logger.error(message, { traceId: traceId(), err, ...detail });
  };
}
