/**
 * Console logger implementation.
 *
 * This is the only destination for error detail: `err.message` routinely contains SQL
 * fragments and table names and must never reach the response body (UC-0.6 I-10).
 * `drain()` lets the gate scripts assert that what is absent from the response IS
 * present in the log, under the same traceId (I-11).
 */
import type { LogFields, LoggerPort } from "../../application/ports/logger.port";

export class ConsoleLogger implements LoggerPort {
  private readonly buffer: { msg: string; fields: LogFields }[] = [];
  /** Keep logs in memory for assertions in check mode only; always false in production */
  constructor(private readonly keep = process.env.KERNEL_KEEP_LOGS === "1") {}

  info(msg: string, fields: LogFields): void {
    if (this.keep) this.buffer.push({ msg, fields });
    process.stdout.write(JSON.stringify({ level: "info", msg, ...fields }) + "\n");
  }

  error(msg: string, fields: LogFields & { err: unknown }): void {
    const err = fields.err;
    const detail =
      err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : { raw: String(err) };
    if (this.keep) this.buffer.push({ msg, fields: { ...fields, detail } as LogFields });
    process.stdout.write(JSON.stringify({ level: "error", msg, traceId: fields.traceId, detail }) + "\n");
  }

  drain(): readonly { msg: string; fields: LogFields }[] {
    return this.buffer;
  }
}
