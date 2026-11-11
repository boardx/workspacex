import { NestFactory } from "@nestjs/core";
import type { NextFunction, Response } from "express";
import type { TracedRequest } from "../../src/interface/middleware/trace";
import { Controller, Get, HttpException, type INestApplication, type ArgumentsHost } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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


// Exercise the same global boundary that previously dropped controller-supplied quota
// guidance before the browser received the 409. No database or authorization is needed.
describe("organization quota guidance through the production HTTP boundary", () => {
  let app: INestApplication | undefined;
  let base: string;
  let thrown: HttpException;

  class QuotaConflictController {
    conflict(): never { throw thrown; }
  }
  Controller("quota-conflict")(QuotaConflictController);
  Get()(QuotaConflictController.prototype, "conflict",
    Object.getOwnPropertyDescriptor(QuotaConflictController.prototype, "conflict")!);

  beforeAll(async () => {
    app = await NestFactory.create({
      module: class QuotaConflictFixture {}, controllers: [QuotaConflictController],
    }, { logger: false });
    app.use((req: TracedRequest, _res: Response, next: NextFunction) => {
      req.traceId = "quota-conflict-trace";
      next();
    });
    app.useGlobalFilters(new AllExceptionsFilter({ info: vi.fn(), error: vi.fn() }, {
      record: vi.fn().mockResolvedValue(undefined), list: vi.fn(), getLifecycle: vi.fn(), updateLifecycle: vi.fn(),
    }));
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  });
  afterAll(async () => { await app?.close(); });

  it("preserves the member Credit usage conflict through HTTP without exposing private detail", async () => {
    thrown = new HttpException({ reasonCode: "MEMBER_CREDIT_LIMIT_BELOW_USAGE", detail: "private usage data" }, 409);
    const response = await fetch(`${base}/quota-conflict`);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "conflict", traceId: "quota-conflict-trace", reasonCode: "MEMBER_CREDIT_LIMIT_BELOW_USAGE",
    });
  });

  it.each([
    { reasonCode: "QUOTA_OVERALLOCATED", remainingTokens: 500000 },
    { reasonCode: "QUOTA_OVERALLOCATED", remainingTokens: 0 },
    { reasonCode: "BUDGET_BELOW_ALLOCATED", allocated: 12500 },
    { reasonCode: "BUDGET_BELOW_ALLOCATED", allocated: 0 },
  ])("preserves numeric guidance including zero: %j", async (guidance) => {
    thrown = new HttpException({ ...guidance, message: "private-sql", secret: "fake-private-secret" }, 409);
    const response = await fetch(`${base}/quota-conflict`);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "conflict", traceId: "quota-conflict-trace", ...guidance });
  });

  it.each([
    ["QUOTA_OVERALLOCATED", "remainingTokens"],
    ["BUDGET_BELOW_ALLOCATED", "allocated"],
  ] as const)("omits malformed %s guidance", async (reasonCode, field) => {
    for (const value of [NaN, Infinity, -Infinity, "12500", -1, 0.5, null, undefined, {}, []]) {
      thrown = new HttpException({ reasonCode, [field]: value, secret: "fake-private-secret" }, 409);
      const response = await fetch(`${base}/quota-conflict`);
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "conflict", traceId: "quota-conflict-trace", reasonCode });
    }
  });

  it.each([
    { reasonCode: "QUOTA_OVERALLOCATED", allocated: 12500 },
    { reasonCode: "BUDGET_BELOW_ALLOCATED", remainingTokens: 500000 },
    { reasonCode: "MEMBER_NOT_FOUND", remainingTokens: 500000, allocated: 12500 },
  ])("does not project cross-fields or unrelated reason guidance: %j", async (body) => {
    thrown = new HttpException(body, 409);
    const response = await fetch(`${base}/quota-conflict`);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "conflict", traceId: "quota-conflict-trace", reasonCode: body.reasonCode });
  });

  it("drops numeric and private fields with an unknown reason", async () => {
    thrown = new HttpException({ reasonCode: "PRIVATE_UNKNOWN_REASON", remainingTokens: 500000,
      allocated: 12500, message: "private-sql", secret: "fake-private-secret" }, 409);
    const response = await fetch(`${base}/quota-conflict`);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "conflict", traceId: "quota-conflict-trace" });
  });

  it.each(["QUOTA_OVERALLOCATED", "BUDGET_BELOW_ALLOCATED"])(
    "keeps %s numeric guidance restricted to 409", async (reasonCode) => {
      for (const [status, error] of [[400, "bad_request"], [403, "forbidden"], [500, "internal_error"]] as const) {
        thrown = new HttpException({ reasonCode, remainingTokens: 500000, allocated: 12500 }, status);
        const response = await fetch(`${base}/quota-conflict`);
        expect(response.status).toBe(status);
        expect(await response.json()).toEqual({ error, traceId: "quota-conflict-trace", reasonCode });
      }
    },
  );
});
