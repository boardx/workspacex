/**
 * `AllExceptionsFilter` -- which branches persist to `ErrorLogPort`, which don't.
 *
 * Only the truly-unhandled branch (neither `ContractValidationError` nor `HttpException`)
 * should call `errorLog.record()` -- see `error-log.port.ts` for why routine rejections
 * (a bad password, a 404) must NOT also hit Postgres on every request. This file pins that
 * boundary down, and separately pins the "a failing record() must never crash the filter or
 * change the response" guarantee -- the whole point of the debugging aid is that it cannot
 * itself become a second incident.
 */
import { describe, expect, it, vi } from "vitest";
import { HttpStatus, NotFoundException } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import { AllExceptionsFilter } from "../../src/interface/filters/all-exceptions.filter";
import { ContractValidationError } from "../../src/interface/pipes/zod-body.pipe";
import type { LoggerPort } from "../../src/application/ports/logger.port";
import type { ErrorLogPort } from "../../src/application/ports/error-log.port";

function fakeHost(traceId: string): { host: ArgumentsHost; res: { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } } {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const res = { status, json };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ traceId }),
      getResponse: () => res,
    }),
    // The filter only ever calls switchToHttp() in this codebase's usage; the rest of
    // ArgumentsHost is unused and deliberately left unimplemented.
  } as unknown as ArgumentsHost;
  return { host, res };
}

function fakeLogger(): LoggerPort {
  return { info: vi.fn(), error: vi.fn() };
}

describe("AllExceptionsFilter -- ErrorLogPort is called for exactly the unhandled branch", () => {
  it("a truly unhandled exception (neither ContractValidationError nor HttpException) is persisted", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const errorLog: ErrorLogPort = { record, list: vi.fn() };
    const filter = new AllExceptionsFilter(fakeLogger(), errorLog);
    const { host } = fakeHost("trace-unhandled");

    filter.catch(new Error("Connection is closed."), host);
    // The call is fire-and-forget (`void ...record().catch(...)`) -- give the microtask
    // queue one tick to run before asserting, same as awaiting a real (already-resolved)
    // promise would.
    await Promise.resolve();

    expect(record).toHaveBeenCalledWith({
      traceId: "trace-unhandled",
      msg: "unhandled exception",
      detail: { name: "Error", message: "Connection is closed.", stack: expect.any(String) },
    });
  });

  it("an HttpException (routine 401/403/404/...) is NOT persisted -- only console-logged", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const errorLog: ErrorLogPort = { record, list: vi.fn() };
    const filter = new AllExceptionsFilter(fakeLogger(), errorLog);
    const { host } = fakeHost("trace-http");

    filter.catch(new NotFoundException("not_found"), host);
    await Promise.resolve();

    expect(record).not.toHaveBeenCalled();
  });

  it("a ContractValidationError (400, a caller mistake) is NOT persisted", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const errorLog: ErrorLogPort = { record, list: vi.fn() };
    const filter = new AllExceptionsFilter(fakeLogger(), errorLog);
    const { host } = fakeHost("trace-validation");

    filter.catch(new ContractValidationError([{ path: "email", code: "invalid_string" }]), host);
    await Promise.resolve();

    expect(record).not.toHaveBeenCalled();
  });

  it("a rejecting errorLog.record() does not crash the filter or change the response", async () => {
    const record = vi.fn().mockRejectedValue(new Error("Postgres is also down"));
    const errorLog: ErrorLogPort = { record, list: vi.fn() };
    const filter = new AllExceptionsFilter(fakeLogger(), errorLog);
    const { host, res } = fakeHost("trace-double-outage");

    expect(() => filter.catch(new Error("original failure"), host)).not.toThrow();
    await Promise.resolve();
    // Let the rejected promise's .catch(() => undefined) settle too.
    await Promise.resolve();

    expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(res.json).toHaveBeenCalledWith({ error: "internal_error", traceId: "trace-double-outage" });
  });
});
