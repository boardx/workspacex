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

it("retains a forbidden response as the cause without changing the legacy system-error contract", async () => {
  const cause = new ApiError(403, "PRIVATE_UNKNOWN_REASON", { error: "private-server-detail" });
  apiRequest.mockRejectedValueOnce(cause);
  const result = await surveyRequest("/surveys/raw-survey").catch(error => error);
  expect(result).toBeInstanceOf(SurveySystemError);
  if (!(result instanceof SurveySystemError)) throw new Error("Expected the legacy survey system-error type");
  expect(result.message).toBe("请求未完成，请检查网络后重试。"); expect(result.retryable).toBe(true);
  expect(result.cause).toBe(cause); expect(cause.status).toBe(403);
  expect(apiRequest).toHaveBeenCalledTimes(1);
});

const legacyStatusMessages: [number, string | null, string][] = [
  [401, null, "请先登录后再操作。"],
  [404, null, "问卷不存在或没有访问权限。"],
  [410, null, "问卷已关闭、已过期或题目已锁定。"],
  [429, null, "提交过于频繁，请稍后重试。"],
  [400, null, "请检查题目、模板配置和有效答卷后重试。"],
  [403, "SURVEY_NOT_STARTED", "问卷尚未开始回收，请在开始时间后再来填写。"],
  [403, "SURVEY_COLLECTION_WINDOW_INVALID", "截止时间必须晚于开始时间，请检查回收时间。"],
];
it.each(legacyStatusMessages)("preserves the original mapped system error and domain-code precedence for %s/%s", async (status, reason, message) => {
  apiRequest.mockRejectedValueOnce(new ApiError(status, reason, { error: "private-diagnostic-not-for-display" }));
  const result = await surveyRequest("/surveys/raw-survey").catch(error => error);
  expect(result).toBeInstanceOf(SurveySystemError);
  if (!(result instanceof SurveySystemError)) throw new Error("Expected the legacy survey system-error type");
  expect(result.message).toBe(message); expect(result.retryable).toBe(true);
  expect(result.cause).toBeUndefined(); expect(apiRequest).toHaveBeenCalledTimes(1);
});
