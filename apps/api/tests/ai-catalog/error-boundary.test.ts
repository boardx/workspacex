import { expect, it, vi } from "vitest";
import { ConflictException, type ArgumentsHost } from "@nestjs/common";
import type { ErrorLogPort } from "../../src/application/ports/error-log.port";
import { AllExceptionsFilter } from "../../src/interface/filters/all-exceptions.filter";
function body(reasonCode: string) {
  let result: unknown;
  const response = {
    headersSent: false,
    status: vi.fn(() => response),
    json: vi.fn((value) => {
      result = value;
    }),
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ traceId: "trace-catalog" }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter({ info: vi.fn(), error: vi.fn() }, {
    record: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ items: [], hasMore: false })),
    getLifecycle: vi.fn(async () => null),
    updateLifecycle: vi.fn(async () => null),
  } satisfies ErrorLogPort).catch(new ConflictException({ reasonCode }), host);
  return result;
}

it("preserves registered AI catalog reasons and strips unknown codes and debug payloads", () => {
  for (const reason of [
    "CATALOG_ENTRY_NOT_DRAFT",
    "CATALOG_VERSION_CONFLICT",
    "CATALOG_PUBLISH_REJECTED",
  ])
    expect(body(reason)).toMatchObject({
      error: "conflict",
      reasonCode: reason,
    });
  expect(body("CATALOG_INTERNAL_DATABASE_SECRET")).toEqual({
    error: "conflict",
    traceId: "trace-catalog",
  });
});
