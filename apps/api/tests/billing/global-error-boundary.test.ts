import { HttpException, type ArgumentsHost } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { BillingErrorCode } from "@repo/contracts/billing-credits";
import { AllExceptionsFilter } from "../../src/interface/filters/all-exceptions.filter";
import { BillingHttpException } from "../../src/interface/controllers/billing-http-exception";
import { PersonalCheckoutHttpException } from "../../src/interface/controllers/personal-checkout-http-exception";

describe("billing errors in the production global boundary", () => {
  it.each([
    [new HttpException({ code: "wechat_upstream_failed", diagnostic: "merchant-internal-detail" }, 502), 502, "bad_gateway"],
    [new BillingHttpException("merchant-secret" as BillingErrorCode, 502), 502, "bad_gateway"],
    [new PersonalCheckoutHttpException("merchant-secret" as "idempotency_conflict", 409), 409, "conflict"],
    [new Error("merchant-secret"), 500, "internal_error"],
    [new HttpException({ code: "wechat_upstream_failed", message: "merchant-secret" }, 500), 500, "internal_error"],
  ])("does not expose untrusted detail for case %#", (error, statusCode, publicError) => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const host = { switchToHttp: () => ({ getRequest: () => ({ traceId: "safe-trace" }), getResponse: () => ({ status, json }) }) } as unknown as ArgumentsHost;
    const filter = new AllExceptionsFilter({ info: vi.fn(), error: vi.fn() }, {
      record: vi.fn().mockResolvedValue(undefined), list: vi.fn(), getLifecycle: vi.fn(), updateLifecycle: vi.fn(),
    });
    filter.catch(error, host);
    expect(status).toHaveBeenCalledWith(statusCode);
    expect(json).toHaveBeenCalledWith({ error: publicError, traceId: "safe-trace" });
  });
  it("preserves a declared pricing conflict without exposing arbitrary exception data", () => {
    const json = vi.fn(), status = vi.fn(() => ({ json }));
    const host = { switchToHttp: () => ({ getRequest: () => ({ traceId: "pricing-trace" }), getResponse: () => ({ status, json }) }) } as unknown as ArgumentsHost;
    const filter = new AllExceptionsFilter({ info: vi.fn(), error: vi.fn() }, { record: vi.fn(), list: vi.fn(), getLifecycle: vi.fn(), updateLifecycle: vi.fn() });
    filter.catch(new PersonalCheckoutHttpException("idempotency_conflict", 409), host);
    expect(json).toHaveBeenCalledWith({ error: "conflict", traceId: "pricing-trace", code: "idempotency_conflict" });
  });
});
