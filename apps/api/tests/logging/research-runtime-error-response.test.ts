import { ConflictException, type ArgumentsHost } from "@nestjs/common";
import { research } from "@repo/contracts";
import { describe, expect, it, vi } from "vitest";
import { AllExceptionsFilter } from "../../src/interface/filters/all-exceptions.filter";

function responseFor(body: string | object) {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = { switchToHttp: () => ({
    getRequest: () => ({ traceId: "research-runtime-error" }),
    getResponse: () => ({ status, json }),
  }) } as unknown as ArgumentsHost;
  const filter = new AllExceptionsFilter({ info: vi.fn(), error: vi.fn() });
  filter.catch(new ConflictException(body), host);
  expect(status).toHaveBeenCalledWith(409);
  return json.mock.calls[0]![0];
}

const genericConflict = { error: "conflict", traceId: "research-runtime-error" };

describe("guided research runtime error response", () => {
  it.each(research.operations.executeGuidedResearchRuntime.err)("preserves canonical runtime reason %s without exception details", (reasonCode) => {
    expect(responseFor({ reasonCode, message: "private provider and SQL details", detail: "private source content" }))
      .toEqual({ ...genericConflict, reasonCode });
  });

  it("keeps legacy research error responses", () => {
    const reasonCode = research.ResearchError.parse("RESEARCH_CHECKPOINT_CONFLICT");
    expect(responseFor({ reasonCode })).toEqual({ ...genericConflict, reasonCode });
  });

  it.each(["RESEARCH_REVISION_CONFLICT_UNKNOWN", "private SQL connection string", "", null, 409, ["RESEARCH_REVISION_CONFLICT"], { code: "RESEARCH_REVISION_CONFLICT" }])("filters unknown or malformed reasonCode %j", (reasonCode) => {
    expect(responseFor({ reasonCode, message: "RESEARCH_REVISION_CONFLICT", detail: "private source content" }))
      .toEqual(genericConflict);
  });

  it("does not turn exception message text into a reasonCode", () => {
    expect(responseFor("RESEARCH_REVISION_CONFLICT")).toEqual(genericConflict);
    expect(responseFor({ message: "RESEARCH_REVISION_CONFLICT" })).toEqual(genericConflict);
  });
});
