/**
 * `ClientErrorReportRateLimitGuard` -- unit-level, `RateLimiterPort` faked. Confirms the
 * guard translates a refused verdict into 429, keyed by `req.ip`, and does not consult
 * anything else (no principal needed -- this route is `@Public()`).
 */
import { describe, expect, it, vi } from "vitest";
import { HttpException, type ExecutionContext } from "@nestjs/common";
import { ClientErrorReportRateLimitGuard } from "../../src/interface/guards/client-error-report-rate-limit.guard";
import type { RateLimiterPort } from "../../src/application/ports/rate-limiter.port";

function fakeContext(ip: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ ip }),
    }),
  } as unknown as ExecutionContext;
}

describe("ClientErrorReportRateLimitGuard", () => {
  it("within budget -> passes, and hits the limiter keyed by the caller's IP", async () => {
    const hit = vi.fn().mockResolvedValue({ allowed: true, retryAfterMs: null });
    const limiter: RateLimiterPort = { hit };
    const guard = new ClientErrorReportRateLimitGuard(limiter);

    await expect(guard.canActivate(fakeContext("1.2.3.4"))).resolves.toBe(true);
    expect(hit).toHaveBeenCalledWith("client-error-report:1.2.3.4");
  });

  it("over budget -> 429 with a reasonCode, request never reaches the controller", async () => {
    const hit = vi.fn().mockResolvedValue({ allowed: false, retryAfterMs: 12_345 });
    const limiter: RateLimiterPort = { hit };
    const guard = new ClientErrorReportRateLimitGuard(limiter);

    await expect(guard.canActivate(fakeContext("1.2.3.4"))).rejects.toThrow(HttpException);
    try {
      await guard.canActivate(fakeContext("1.2.3.4"));
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(429);
      expect((e as HttpException).getResponse()).toMatchObject({ reasonCode: "RATE_LIMITED" });
    }
  });

  it("missing req.ip falls back to a stable key rather than throwing", async () => {
    const hit = vi.fn().mockResolvedValue({ allowed: true, retryAfterMs: null });
    const limiter: RateLimiterPort = { hit };
    const guard = new ClientErrorReportRateLimitGuard(limiter);

    await expect(guard.canActivate(fakeContext(undefined))).resolves.toBe(true);
    expect(hit).toHaveBeenCalledWith("client-error-report:unknown");
  });
});
