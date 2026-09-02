/**
 * `SystemErrorLogController` -- unit-level, all ports faked (no DB). Pins down the one thing
 * that matters most about this controller: `GET /system/error-logs` is refused for anyone
 * not on the platform-superuser whitelist, REGARDLESS of org role -- see
 * `@repo/contracts`'s `system-error-logs.ts` file header for why this is not an `orgRole`
 * check (this table has no `org_id`; gating it by org admin would leak every org's incident
 * detail to every other org's admin).
 */
import { describe, expect, it, vi } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { SystemErrorLogController } from "../../src/interface/controllers/system-error-log.controller";
import type { ErrorLogPort } from "../../src/application/ports/error-log.port";
import type { CredentialRepository, CredentialRow } from "../../src/application/auth/ports";
import type { LoggerPort } from "../../src/application/ports/logger.port";
import type { Principal } from "../../src/domain/principal";
import type { OrgId } from "../../src/domain/org-id";

function fakeCredential(email: string): CredentialRow {
  return {
    userId: "u-1",
    email,
    passwordHash: "irrelevant",
    emailVerifiedAt: null,
    displayName: "Test User",
    avatarUrl: null,
  };
}

function fakeLogger(): LoggerPort {
  return { info: vi.fn(), error: vi.fn() };
}

const principal: Principal = { userId: "u-1", orgId: "org-1" as OrgId };

describe("SystemErrorLogController -- GET /system/error-logs", () => {
  it("caller's email is on the whitelist -> delegates to ErrorLogPort.list", async () => {
    const list = vi.fn().mockResolvedValue({ items: [], hasMore: false });
    const errorLog: ErrorLogPort = { record: vi.fn(), list };
    const credentials: CredentialRepository = {
      findByEmail: vi.fn(),
      findByUserId: vi.fn().mockResolvedValue(fakeCredential("ops@example.com")),
      updatePasswordHash: vi.fn(),
      updateDisplayName: vi.fn(),
    } as unknown as CredentialRepository;
    process.env.PLATFORM_SUPERUSER_EMAILS = "ops@example.com";

    const controller = new SystemErrorLogController(errorLog, credentials, fakeLogger());
    const out = await controller.list(principal, undefined, undefined);

    expect(out).toEqual({ items: [], hasMore: false });
    expect(list).toHaveBeenCalledWith({ limit: 50, beforeId: null });
  });

  it("caller's email is NOT on the whitelist -> 403 NOT_PLATFORM_SUPERUSER, list() never called", async () => {
    const list = vi.fn();
    const errorLog: ErrorLogPort = { record: vi.fn(), list };
    const credentials: CredentialRepository = {
      findByEmail: vi.fn(),
      findByUserId: vi.fn().mockResolvedValue(fakeCredential("member@example.com")),
      updatePasswordHash: vi.fn(),
      updateDisplayName: vi.fn(),
    } as unknown as CredentialRepository;
    process.env.PLATFORM_SUPERUSER_EMAILS = "ops@example.com";

    const controller = new SystemErrorLogController(errorLog, credentials, fakeLogger());

    await expect(controller.list(principal, undefined, undefined)).rejects.toThrow(ForbiddenException);
    expect(list).not.toHaveBeenCalled();
  });

  it("no PLATFORM_SUPERUSER_EMAILS configured at all -> nobody passes, not 'allow everyone'", async () => {
    const list = vi.fn();
    const errorLog: ErrorLogPort = { record: vi.fn(), list };
    const credentials: CredentialRepository = {
      findByEmail: vi.fn(),
      findByUserId: vi.fn().mockResolvedValue(fakeCredential("ops@example.com")),
      updatePasswordHash: vi.fn(),
      updateDisplayName: vi.fn(),
    } as unknown as CredentialRepository;
    delete process.env.PLATFORM_SUPERUSER_EMAILS;

    const controller = new SystemErrorLogController(errorLog, credentials, fakeLogger());

    await expect(controller.list(principal, undefined, undefined)).rejects.toThrow(ForbiddenException);
  });
});

describe("SystemErrorLogController -- POST /system/client-error-reports", () => {
  it("always records and returns a traceId, even though the route is @Public()", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const errorLog: ErrorLogPort = { record, list: vi.fn() };
    const credentials = {} as CredentialRepository;

    const controller = new SystemErrorLogController(errorLog, credentials, fakeLogger());
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
    const controller = new SystemErrorLogController(errorLog, {} as CredentialRepository, fakeLogger());

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
