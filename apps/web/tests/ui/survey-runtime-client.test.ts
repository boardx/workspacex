import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { SurveyPublishBlocker } from "@repo/contracts/survey";
import { SurveyRuntimeSchema } from "@repo/contracts/survey-runtime";

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
  surveySourceRequest,
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

  it("accepts both legacy runtime payloads and server-provided Markdown source without synthesizing it", async () => {
    const legacy = SurveyRuntimeSchema.safeParse({
      id: "survey-legacy", version: 1, status: "draft", anonymity: "anonymous", updatedAt: "2026-09-26T00:00:00.000Z",
      title: "遗留问卷", questions: [], template: { id: "report", title: "报告", sections: [] }, responses: [], publication: null,
      report: null, reportBasisVersion: null, reportBasisAnswerRevision: null, reportGeneratedAt: null,
    });
    expect(legacy.success).toBe(true);
    apiRequest.mockResolvedValueOnce({
      documents: {
        design: { kind: "design", markdown: "# 服务端问卷\n", revision: 1, updatedAt: "2026-09-26T00:00:00.000Z", parseStatus: "valid" },
        publication: { kind: "publication", markdown: "# 发布设置\n", revision: 1, updatedAt: "2026-09-26T00:00:00.000Z", parseStatus: "valid" },
        reportTemplate: { kind: "report_template", markdown: "# 报告模板\n", revision: 1, updatedAt: "2026-09-26T00:00:00.000Z", parseStatus: "valid" },
      }, compiledVersion: 1, contentHash: "a".repeat(64),
    });
    const source = await surveySourceRequest("/surveys/survey-legacy/source");
    expect(source.documents.design.markdown).toBe("# 服务端问卷\n");
    expect(apiRequest).toHaveBeenCalledWith("/surveys/survey-legacy/source", {});
  });
});
