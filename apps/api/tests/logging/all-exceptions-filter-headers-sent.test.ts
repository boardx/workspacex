/**
 * `AllExceptionsFilter` after the response headers are already out (a streaming handler --
 * SSE / chunked -- that fails mid-stream). Calling `res.status().json()` there throws
 * ERR_HTTP_HEADERS_SENT *out of the filter*, and Nest has nothing above it: the whole API
 * process died this way on WorkspaceX Local (2026-09-17, a DB stall mid-stream). The filter
 * must log, end the connection and return -- never touch status/json.
 */
import { describe, expect, it, vi } from "vitest";
import type { ArgumentsHost } from "@nestjs/common";
import { NotFoundException } from "@nestjs/common";
import { AllExceptionsFilter } from "../../src/interface/filters/all-exceptions.filter";
import type { ErrorLogPort } from "../../src/application/ports/error-log.port";

function hostWithHeadersSent(): { host: ArgumentsHost; res: Record<string, ReturnType<typeof vi.fn>> } {
  const res = {
    headersSent: true,
    status: vi.fn(() => { throw new Error("ERR_HTTP_HEADERS_SENT: Cannot set headers after they are sent to the client"); }),
    json: vi.fn(() => { throw new Error("ERR_HTTP_HEADERS_SENT: Cannot set headers after they are sent to the client"); }),
    end: vi.fn(),
  } as unknown as Record<string, ReturnType<typeof vi.fn>>;
  const host = { switchToHttp: () => ({ getRequest: () => ({ traceId: "t-stream" }), getResponse: () => res }) } as unknown as ArgumentsHost;
  return { host, res };
}

describe("AllExceptionsFilter -- headers already sent", () => {
  const errorLog: ErrorLogPort = { record: vi.fn().mockResolvedValue(undefined), list: vi.fn(), getLifecycle: vi.fn(), updateLifecycle: vi.fn() };

  it("an unhandled error mid-stream ends the response instead of throwing out of the filter", () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const filter = new AllExceptionsFilter(logger, errorLog);
    const { host, res } = hostWithHeadersSent();
    expect(() => filter.catch(new Error("timeout exceeded when trying to connect"), host)).not.toThrow();
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith("exception after headers sent; closing response", expect.objectContaining({ traceId: "t-stream" }));
  });

  it("counter-evidence: an HttpException mid-stream takes the same path (status/json are unusable once headers are out)", () => {
    const filter = new AllExceptionsFilter({ info: vi.fn(), error: vi.fn() }, errorLog);
    const { host, res } = hostWithHeadersSent();
    expect(() => filter.catch(new NotFoundException(), host)).not.toThrow();
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
