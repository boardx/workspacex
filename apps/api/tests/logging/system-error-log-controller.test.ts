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
    const errorLog: ErrorLogPort = { record: vi.fn(), list, getLifecycle: vi.fn(), updateLifecycle: vi.fn() };

    const controller = new SystemErrorLogController(errorLog, fakeLogger());
    const out = await controller.list(principal, undefined, undefined);

    expect(out).toEqual({ items: [], hasMore: false });
    expect(list).toHaveBeenCalledWith({ limit: 50, beforeId: null });
  });

  it("an out-of-range limit query param falls back to the default rather than passing it through raw", async () => {
    const list = vi.fn().mockResolvedValue({ items: [], hasMore: false });
    const errorLog: ErrorLogPort = { record: vi.fn(), list, getLifecycle: vi.fn(), updateLifecycle: vi.fn() };
    const controller = new SystemErrorLogController(errorLog, fakeLogger());

    await controller.list(principal, "9999", undefined);
    expect(list).toHaveBeenCalledWith({ limit: 50, beforeId: null });
  });

  it("a valid limit + beforeId pass through", async () => {
    const list = vi.fn().mockResolvedValue({ items: [], hasMore: false });
    const errorLog: ErrorLogPort = { record: vi.fn(), list, getLifecycle: vi.fn(), updateLifecycle: vi.fn() };
    const controller = new SystemErrorLogController(errorLog, fakeLogger());

    await controller.list(principal, "10", "42");
    expect(list).toHaveBeenCalledWith({ limit: 10, beforeId: "42" });
  });
});

describe("SystemErrorLogController -- PUT /system/error-logs/:id", () => {
  it("moves 待处理 to 已转入开发 with an optional dev note", async () => {
    const getLifecycle = vi.fn().mockResolvedValue({ status: "待处理", statusReason: null, devNote: null, tags: [] });
    const updateLifecycle = vi.fn().mockResolvedValue(undefined);
    const errorLog: ErrorLogPort = { record: vi.fn(), list: vi.fn(), getLifecycle, updateLifecycle };
    const controller = new SystemErrorLogController(errorLog, fakeLogger());

    const out = await controller.updateLifecycle(principal, "1", {
      id: "1", status: "已转入开发", statusReason: undefined, devNote: "指派给 @foo", tags: undefined,
    });

    expect(out).toEqual({ id: "1", status: "已转入开发", statusReason: null, devNote: "指派给 @foo", tags: [] });
    expect(updateLifecycle).toHaveBeenCalledWith("1", {
      status: "已转入开发", statusReason: null, devNote: "指派给 @foo", tags: [],
    });
  });

  it("转不做 without a reason is rejected as 422 REASON_REQUIRED", async () => {
    const getLifecycle = vi.fn().mockResolvedValue({ status: "待处理", statusReason: null, devNote: null, tags: [] });
    const errorLog: ErrorLogPort = { record: vi.fn(), list: vi.fn(), getLifecycle, updateLifecycle: vi.fn() };
    const controller = new SystemErrorLogController(errorLog, fakeLogger());

    await expect(
      controller.updateLifecycle(principal, "1", { id: "1", status: "不做", statusReason: undefined, devNote: undefined, tags: undefined }),
    ).rejects.toMatchObject({ response: { reasonCode: "REASON_REQUIRED" } });
  });

  it("an illegal transition (已修复-shaped: 不做 -> 已转入开发 is not a valid edge) is rejected as 422 INVALID_TRANSITION", async () => {
    const getLifecycle = vi.fn().mockResolvedValue({ status: "不做", statusReason: "存档", devNote: null, tags: [] });
    const errorLog: ErrorLogPort = { record: vi.fn(), list: vi.fn(), getLifecycle, updateLifecycle: vi.fn() };
    const controller = new SystemErrorLogController(errorLog, fakeLogger());

    await expect(
      controller.updateLifecycle(principal, "1", { id: "1", status: "已转入开发", statusReason: undefined, devNote: undefined, tags: undefined }),
    ).rejects.toMatchObject({ response: { reasonCode: "INVALID_TRANSITION", from: "不做", to: "已转入开发" } });
  });

  it("an unknown id is rejected as 404 NOT_FOUND", async () => {
    const getLifecycle = vi.fn().mockResolvedValue(null);
    const errorLog: ErrorLogPort = { record: vi.fn(), list: vi.fn(), getLifecycle, updateLifecycle: vi.fn() };
    const controller = new SystemErrorLogController(errorLog, fakeLogger());

    await expect(
      controller.updateLifecycle(principal, "missing", { id: "missing", status: undefined, statusReason: undefined, devNote: undefined, tags: undefined }),
    ).rejects.toMatchObject({ response: { reasonCode: "NOT_FOUND" } });
  });

  it("tags can be edited independently of status, keeping the current status", async () => {
    const getLifecycle = vi.fn().mockResolvedValue({ status: "已转入开发", statusReason: null, devNote: "备注", tags: ["旧标签"] });
    const updateLifecycle = vi.fn().mockResolvedValue(undefined);
    const errorLog: ErrorLogPort = { record: vi.fn(), list: vi.fn(), getLifecycle, updateLifecycle };
    const controller = new SystemErrorLogController(errorLog, fakeLogger());

    const out = await controller.updateLifecycle(principal, "1", {
      id: "1", status: undefined, statusReason: undefined, devNote: undefined, tags: ["新标签"],
    });

    expect(out).toEqual({ id: "1", status: "已转入开发", statusReason: null, devNote: "备注", tags: ["新标签"] });
    expect(updateLifecycle).toHaveBeenCalledWith("1", { status: "已转入开发", statusReason: null, devNote: "备注", tags: ["新标签"] });
  });
});

describe("SystemErrorLogController -- POST /system/client-error-reports", () => {
  it("always records and returns a traceId, even though the route is @Public()", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const errorLog: ErrorLogPort = { record, list: vi.fn(), getLifecycle: vi.fn(), updateLifecycle: vi.fn() };

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
    const errorLog: ErrorLogPort = { record, list: vi.fn(), getLifecycle: vi.fn(), updateLifecycle: vi.fn() };
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
