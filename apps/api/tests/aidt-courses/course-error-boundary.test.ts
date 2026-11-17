import { expect, it, vi } from "vitest";
import { HttpException, type ArgumentsHost } from "@nestjs/common";
import { CourseError } from "@repo/contracts/aidt-courses";
import type { ErrorLogPort } from "../../src/application/ports/error-log.port";
import { AllExceptionsFilter } from "../../src/interface/filters/all-exceptions.filter";
function filtered(reasonCode: string, status: number) {
  let body: unknown; let actualStatus: number | undefined;
  const response = { headersSent: false, status: vi.fn((value: number) => { actualStatus = value; return response; }), json: vi.fn(value => { body = value; }) };
  const host = { switchToHttp: () => ({ getRequest: () => ({ traceId: "trace-aidt-course" }), getResponse: () => response }) } as unknown as ArgumentsHost;
  const errorLog = { record: vi.fn(async () => undefined), list: vi.fn(async () => ({ items: [], hasMore: false })), getLifecycle: vi.fn(async () => null), updateLifecycle: vi.fn(async () => null) } satisfies ErrorLogPort;
  new AllExceptionsFilter({ info: vi.fn(), error: vi.fn() }, errorLog).catch(new HttpException({ reasonCode, current: { private: "unapproved course body" }, debug: "private SQL", role: "admin" }, status), host);
  return { status: actualStatus, body };
}
it.each(CourseError.options)("real global Filter preserves closed course reason %s and strips unrelated fields", reason => {
  const status = reason.endsWith("NOT_FOUND") ? 404 : reason.endsWith("FORBIDDEN") ? 403 : reason.endsWith("CONFLICT") ? 409 : reason.endsWith("INVALID") ? 400 : 503;
  const response = filtered(reason, status);
  expect(response.status).toBe(status);
  expect(response.body).toMatchObject({ reasonCode: reason, traceId: "trace-aidt-course" });
  expect(Object.keys(response.body as object).sort()).toEqual(["error", "reasonCode", "traceId"]);
});
it("keeps unknown course/raw strings outside the global allowlist", () => {
  for (const reason of ["AIDT_COURSE_DATABASE_SECRET", "AIDT_UPLOAD_UNDECLARED_INTERNAL_SECRET"]) expect(filtered(reason, 409).body).toEqual({ error: "conflict", traceId: "trace-aidt-course" });
});
it("retains the already registered closed raw Files errors without a duplicate permissive branch", () => {
  for (const reason of ["INGESTION_FAILED", "DEPENDENCY_UNAVAILABLE", "INTEGRITY_CHECK_FAILED", "PROJECT_ROLE_INSUFFICIENT"]) expect(filtered(reason, 422).body).toMatchObject({ reasonCode: reason });
});
