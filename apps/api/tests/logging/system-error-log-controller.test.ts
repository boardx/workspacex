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
  it("moves 待处理 to 已转入开发 with an optional dev note, guarded by expectedStatus", async () => {
    const getLifecycle = vi.fn().mockResolvedValue({ status: "待处理", statusReason: null, devNote: null, tags: [] });
    const updateLifecycle = vi.fn().mockResolvedValue({ status: "已转入开发", statusReason: null, devNote: "指派给 @foo", tags: [] });
    const errorLog: ErrorLogPort = { record: vi.fn(), list: vi.fn(), getLifecycle, updateLifecycle };
    const controller = new SystemErrorLogController(errorLog, fakeLogger());

    const out = await controller.updateLifecycle(principal, "1", {
      id: "1", status: "已转入开发", statusReason: undefined, devNote: "指派给 @foo", tags: undefined,
    });

    expect(out).toEqual({ id: "1", status: "已转入开发", statusReason: null, devNote: "指派给 @foo", tags: [] });
    expect(updateLifecycle).toHaveBeenCalledWith("1", {
      expectedStatus: "待处理", status: "已转入开发", statusReason: null, devNote: "指派给 @foo", tags: undefined,
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

  it("反证①：幂等重放（已经是「不做」，再传一次 status:不做 但不带理由）同样被拒——不是只在真转移时才校验", async () => {
    const getLifecycle = vi.fn().mockResolvedValue({ status: "不做", statusReason: "旧理由", devNote: null, tags: [] });
    const errorLog: ErrorLogPort = { record: vi.fn(), list: vi.fn(), getLifecycle, updateLifecycle: vi.fn() };
    const controller = new SystemErrorLogController(errorLog, fakeLogger());

    await expect(
      controller.updateLifecycle(principal, "1", { id: "1", status: "不做", statusReason: undefined, devNote: undefined, tags: undefined }),
    ).rejects.toMatchObject({ response: { reasonCode: "REASON_REQUIRED" } });
  });

  it("反证①：不随 status 一起提交的 statusReason（\"只改标签顺带清理由\"那类请求）被拒为 422 REASON_REQUIRES_STATUS", async () => {
    const getLifecycle = vi.fn().mockResolvedValue({ status: "不做", statusReason: "旧理由", devNote: null, tags: ["a"] });
    const errorLog: ErrorLogPort = { record: vi.fn(), list: vi.fn(), getLifecycle, updateLifecycle: vi.fn() };
    const controller = new SystemErrorLogController(errorLog, fakeLogger());

    await expect(
      controller.updateLifecycle(principal, "1", { id: "1", status: undefined, statusReason: null, devNote: undefined, tags: ["b"] }),
    ).rejects.toMatchObject({ response: { reasonCode: "REASON_REQUIRES_STATUS" } });
  });

  it("离开「不做」自动清空旧存档理由——退回待处理不会带着旧理由", async () => {
    const getLifecycle = vi.fn().mockResolvedValue({ status: "不做", statusReason: "旧理由", devNote: null, tags: [] });
    const updateLifecycle = vi.fn().mockResolvedValue({ status: "待处理", statusReason: null, devNote: null, tags: [] });
    const errorLog: ErrorLogPort = { record: vi.fn(), list: vi.fn(), getLifecycle, updateLifecycle };
    const controller = new SystemErrorLogController(errorLog, fakeLogger());

    const out = await controller.updateLifecycle(principal, "1", { id: "1", status: "待处理", statusReason: undefined, devNote: undefined, tags: undefined });

    expect(out.statusReason).toBeNull();
    expect(updateLifecycle).toHaveBeenCalledWith("1", { expectedStatus: "不做", status: "待处理", statusReason: null, devNote: undefined, tags: undefined });
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

  it("tags can be edited independently of status — repo.updateLifecycle called with expectedStatus:null (status untouched)", async () => {
    const getLifecycle = vi.fn().mockResolvedValue({ status: "已转入开发", statusReason: null, devNote: "备注", tags: ["旧标签"] });
    const updateLifecycle = vi.fn().mockResolvedValue({ status: "已转入开发", statusReason: null, devNote: "备注", tags: ["新标签"] });
    const errorLog: ErrorLogPort = { record: vi.fn(), list: vi.fn(), getLifecycle, updateLifecycle };
    const controller = new SystemErrorLogController(errorLog, fakeLogger());

    const out = await controller.updateLifecycle(principal, "1", {
      id: "1", status: undefined, statusReason: undefined, devNote: undefined, tags: ["新标签"],
    });

    expect(out).toEqual({ id: "1", status: "已转入开发", statusReason: null, devNote: "备注", tags: ["新标签"] });
    expect(updateLifecycle).toHaveBeenCalledWith("1", { expectedStatus: null, status: undefined, statusReason: undefined, devNote: undefined, tags: ["新标签"] });
  });

  it("反证②：repo.updateLifecycle 返回 null（乐观锁 CAS 未命中 = 并发冲突）被映射为 409 CONCURRENT_UPDATE", async () => {
    const getLifecycle = vi.fn().mockResolvedValue({ status: "待处理", statusReason: null, devNote: null, tags: [] });
    const updateLifecycle = vi.fn().mockResolvedValue(null);
    const errorLog: ErrorLogPort = { record: vi.fn(), list: vi.fn(), getLifecycle, updateLifecycle };
    const controller = new SystemErrorLogController(errorLog, fakeLogger());

    await expect(
      controller.updateLifecycle(principal, "1", { id: "1", status: "已转入开发", statusReason: undefined, devNote: undefined, tags: undefined }),
    ).rejects.toMatchObject({ response: { reasonCode: "CONCURRENT_UPDATE" } });
    expect(updateLifecycle).toHaveBeenCalledWith("1", { expectedStatus: "待处理", status: "已转入开发", statusReason: null, devNote: undefined, tags: undefined });
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

  // issue #2797 -- chat/agent-run capture points additionally send runId/threadId/phase/
  // errorType so a real incident (e.g. a real `MODEL_CALL_FAILED` run) can be pulled back
  // out by runId, not just by scrolling a message string.
  it("issue #2797 -- agent-run context fields (runId/threadId/phase/errorType) flow into detail when present", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const errorLog: ErrorLogPort = { record, list: vi.fn(), getLifecycle: vi.fn(), updateLifecycle: vi.fn() };
    const controller = new SystemErrorLogController(errorLog, fakeLogger());

    const out = await controller.report({ traceId: "trace-client-3" }, {
      message: "agent run failed",
      stack: null,
      url: "/chat",
      userAgent: "test-agent",
      appVersion: "2026.09.05",
      runId: "run-1",
      threadId: "thread-1",
      phase: "acting",
      errorType: "MODEL_CALL_FAILED",
    });

    expect(out).toEqual({ traceId: "trace-client-3" });
    await Promise.resolve();
    expect(record).toHaveBeenCalledWith({
      traceId: "trace-client-3",
      msg: "client error: agent run failed",
      detail: {
        message: "agent run failed",
        stack: undefined,
        url: "/chat",
        userAgent: "test-agent",
        appVersion: "2026.09.05",
        runId: "run-1",
        threadId: "thread-1",
        phase: "acting",
        errorType: "MODEL_CALL_FAILED",
      },
    });
  });

  it("issue #2797 -- omitted agent-run context fields don't appear as literal nulls in detail (a caller that never learns about runId shouldn't manufacture one)", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const errorLog: ErrorLogPort = { record, list: vi.fn(), getLifecycle: vi.fn(), updateLifecycle: vi.fn() };
    const controller = new SystemErrorLogController(errorLog, fakeLogger());

    await controller.report({ traceId: "trace-client-4" }, {
      message: "boom", stack: null, url: null, userAgent: null, appVersion: null,
    });
    await Promise.resolve();

    const [{ detail }] = record.mock.calls.at(-1) as [{ detail: Record<string, unknown> }];
    expect(detail.runId).toBeUndefined();
    expect(detail.threadId).toBeUndefined();
    expect(detail.phase).toBeUndefined();
    expect(detail.errorType).toBeUndefined();
  });
});
