import { expect, it } from "vitest";
import { designWorkbench, feedbackLoop } from "@repo/contracts";
import { ApiError } from "@/lib/api-client";
import { describeFailure } from "@/lib/design-failure";
it("gives every known contract error its own localized explanation and keeps the Chinese default", () => {
  const unknown = new ApiError(400, "UNKNOWN_PRIVATE_REASON", {});
  for (const code of new Set([...designWorkbench.DesignWorkbenchError.options, ...feedbackLoop.FeedbackError.options])) {
    const error = new ApiError(400, code, {});
    const en = describeFailure(error, "en");
    expect(en).not.toMatch(/\p{Script=Han}/u);
    expect(en).not.toContain(code);
    expect(en).not.toBe(describeFailure(unknown, "en"));
    expect(describeFailure(error)).toBe(describeFailure(error, "zh-CN"));
    expect(describeFailure(error)).toMatch(/\p{Script=Han}/u);
  }
});
it("preserves the existing overlapping-code precedence and masks unknown/prototype codes", () => {
  const error = new ApiError(500, "DEPENDENCY_UNAVAILABLE", {});
  expect(describeFailure(error)).toBe("服务暂时不可用，稍后再试一次");
  expect(describeFailure(error, "en")).toBe("The service is temporarily unavailable. Please try again later.");
  for (const code of ["toString", "constructor", "__proto__", "UNKNOWN_PRIVATE_REASON"]) {
    expect(describeFailure(new ApiError(400, code, {}), "en")).toBe("The request failed. Please try again later.");
  }
});
it("localizes HTTP/network fallback and keeps private unknown details hidden", () => {
  expect(describeFailure(new ApiError(429, null, {}), "en")).toContain("Too many requests");
  expect(describeFailure(new TypeError("private host"), "en")).toContain("Check your network");
  expect(describeFailure(new Error("private stack"), "en")).toBe("Something went wrong. Please try again later.");
  expect(describeFailure(new Error("private stack"))).toBe("出了点问题，稍后再试一次");
});
