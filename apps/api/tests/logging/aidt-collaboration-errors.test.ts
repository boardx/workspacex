import { expect, it, vi } from "vitest";
import { HttpException } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import { AllExceptionsFilter } from "../../src/interface/filters/all-exceptions.filter";

function filtered(body: unknown, status: number) {
  const json = vi.fn(), response = { status: vi.fn(() => ({ json })) };
  const host = { switchToHttp: () => ({ getRequest: () => ({ traceId: "collaboration-error" }), getResponse: () => response }) } as unknown as ArgumentsHost;
  new AllExceptionsFilter({ info: vi.fn(), error: vi.fn() }, { record: vi.fn().mockResolvedValue(undefined), list: vi.fn(), getLifecycle: vi.fn(), updateLifecycle: vi.fn() }).catch(new HttpException(body as object, status), host);
  return json.mock.calls[0]![0] as Record<string, unknown>;
}
it("preserves the new closed error codes without leaking arbitrary exception fields", () => {
  for (const [reasonCode, status] of [["IDEMPOTENCY_CONFLICT", 409], ["READ_ONLY_ARCHIVED", 403], ["AIDT_STAGE_READONLY", 403], ["AIDT_STAGE_INVALID", 422]] as const) {
    const response = filtered({ reasonCode, sql: "SECRET SQL", message: "SECRET", stack: "SECRET" }, status);
    expect(response.reasonCode).toBe(reasonCode); expect(JSON.stringify(response)).not.toContain("SECRET");
  }
  expect(filtered({ reasonCode: "UNREVIEWED_REASON", secret: "SECRET" }, 409)).not.toHaveProperty("reasonCode");
});
it("returns only a schema-checked authorized current draft for revision conflicts", () => {
  const current = { projectId: "group", stageId: 1, revision: 2, content: { schemaVersion: 1, draft: { fields: { initial: "学生稿" }, ideas: [], selectedIdeaId: "" } }, sourceStageRevisions: [], updatedBy: "member", updatedAt: "2026-11-15T00:00:00.000Z" };
  expect(filtered({ reasonCode: "AIDT_STAGE_REVISION_CONFLICT", current: { ...current, sql: "SECRET" } }, 409).current).toEqual(current);
  expect(filtered({ reasonCode: "AIDT_STAGE_REVISION_CONFLICT", current: { secret: "SECRET" } }, 409)).not.toHaveProperty("current");
  expect(filtered({ reasonCode: "AIDT_STAGE_NOT_FOUND", current }, 404)).not.toHaveProperty("current");
  expect(filtered({ reasonCode: "IDEMPOTENCY_CONFLICT", current }, 409)).not.toHaveProperty("current");
});
