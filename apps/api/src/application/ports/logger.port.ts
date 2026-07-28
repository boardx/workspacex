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
