import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { SurveyPublishBlocker } from "@repo/contracts/survey";

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  apiRequest,
}));

import { ApiError } from "@/lib/api-client";
import {
  surveyRequest,
  SurveyConflictError,
  SurveyPublishBlockedError,
  SurveySystemError,
} from "@/lib/survey/runtime-client";

beforeEach(() => apiRequest.mockReset());

describe("survey runtime client error contract", () => {
  it("preserves every validated blocker from a 422 response", async () => {
    const blockers: SurveyPublishBlocker[] = [{ code: "QUESTIONS_EMPTY", side: "survey", subjectId: "survey-1", missingFields: ["questions"] }];
    apiRequest.mockRejectedValueOnce(new ApiError(422, "SURVEY_PUBLISH_BLOCKED", { reasonCode: "SURVEY_PUBLISH_BLOCKED", blockers }));
    await expect(surveyRequest("/surveys/survey-1/prepare")).rejects.toMatchObject({
      name: "SurveyPublishBlockedError",
      blockers,
    } satisfies Partial<SurveyPublishBlockedError>);
  });

  it("keeps conflicts distinct from retryable system failures", async () => {
    apiRequest.mockRejectedValueOnce(new ApiError(409, "SURVEY_VERSION_CONFLICT", {}));
    await expect(surveyRequest("/surveys/survey-1")).rejects.toBeInstanceOf(SurveyConflictError);
    apiRequest.mockRejectedValueOnce(new ApiError(500, null, {}));
    await expect(surveyRequest("/surveys/survey-1")).rejects.toMatchObject({ retryable: true } satisfies Partial<SurveySystemError>);
  });

  it("rejects a successful response that violates the supplied schema", async () => {
    apiRequest.mockResolvedValueOnce({ status: "invented" });
    await expect(surveyRequest("/surveys/survey-1", {}, z.object({ status: z.literal("draft") }))).rejects.toBeInstanceOf(SurveySystemError);
  });
});
