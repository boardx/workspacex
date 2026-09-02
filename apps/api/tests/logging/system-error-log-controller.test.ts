/**
 * `SystemErrorLogController` -- unit-level, all ports faked (no DB).
 *
 * Authorization for `GET /system/error-logs` is no longer tested here: it moved to
 * `PlatformSuperuserGuard` (review finding, PR #2475 -- see that file's own test,
 * `platform-superuser-guard.test.ts`), and this controller no longer has an
 * authorization decision to make at all. What is left to pin down here is the two
 * things that are genuinely this controller's job: delegating to `ErrorLogPort` with the
 * right pagination args, and the client-error-report write path's fire-and-forget
 * discipline.
 */
import { describe, expect, it, vi } from "vitest";
import { SystemErrorLogController } from "../../src/interface/controllers/system-error-log.controller";
import type { ErrorLogPort } from "../../src/application/ports/error-log.port";
import type { LoggerPort } from "../../src/application/ports/logger.port";
import type { Principal } from "../../src/domain/principal";
import type { OrgId } from "../../src/domain/org-id";

function fakeLogger(): LoggerPort {
  return { info: vi.fn(), error: vi.fn() };
}

const principal: Principal = { userId: "u-1", orgId: "org-1" as OrgId };

describe("SystemErrorLogController -- GET /system/error-logs", () => {
  it("delegates to ErrorLogPort.list with default pagination", async () => {
    const list = vi.fn().mockResolvedValue({ items: [], hasMore: false });
    const errorLog: ErrorLogPort = { record: vi.fn(), list };

    const controller = new SystemErrorLogController(errorLog, fakeLogger());
    const out = await controller.list(principal, undefined, undefined);

    expect(out).toEqual({ items: [], hasMore: false });
    expect(list).toHaveBeenCalledWith({ limit: 50, beforeId: null });
  });

  it("an out-of-range limit query param falls back to the default rather than passing it through raw", async () => {
    const list = vi.fn().mockResolvedValue({ items: [], hasMore: false });
    const errorLog: ErrorLogPort = { record: vi.fn(), list };
    const controller = new SystemErrorLogController(errorLog, fakeLogger());

    await controller.list(principal, "9999", undefined);
    expect(list).toHaveBeenCalledWith({ limit: 50, beforeId: null });
  });

  it("a valid limit + beforeId pass through", async () => {
    const list = vi.fn().mockResolvedValue({ items: [], hasMore: false });
    const errorLog: ErrorLogPort = { record: vi.fn(), list };
    const controller = new SystemErrorLogController(errorLog, fakeLogger());

    await controller.list(principal, "10", "42");
    expect(list).toHaveBeenCalledWith({ limit: 10, beforeId: "42" });
  });
});

describe("SystemErrorLogController -- POST /system/client-error-reports", () => {
  it("always records and returns a traceId, even though the route is @Public()", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const errorLog: ErrorLogPort = { record, list: vi.fn() };

    const controller = new SystemErrorLogController(errorLog, fakeLogger());
    const out = await controller.report({ traceId: "trace-client-1" }, {
      message: "boom",
      stack: null,
      url: "/chat",
      userAgent: "test-agent",
      appVersion: "2026.09.02",
    });

    expect(out).toEqual({ traceId: "trace-client-1" });
    // Fire-and-forget -- give the microtask queue one tick before asserting, same discipline
    // as `all-exceptions-filter-error-log.test.ts`.
    await Promise.resolve();
    expect(record).toHaveBeenCalledWith({
      traceId: "trace-client-1",
      msg: "client error: boom",
      detail: {
        message: "boom",
        stack: undefined,
        url: "/chat",
        userAgent: "test-agent",
        appVersion: "2026.09.02",
      },
    });
  });

  it("a rejecting record() does not throw out of the handler", async () => {
    const record = vi.fn().mockRejectedValue(new Error("db down"));
    const errorLog: ErrorLogPort = { record, list: vi.fn() };
    const controller = new SystemErrorLogController(errorLog, fakeLogger());

    await expect(
      controller.report({ traceId: "trace-client-2" }, {
        message: "boom",
        stack: null,
        url: null,
        userAgent: null,
        appVersion: null,
      }),
    ).resolves.toEqual({ traceId: "trace-client-2" });
  });
});
