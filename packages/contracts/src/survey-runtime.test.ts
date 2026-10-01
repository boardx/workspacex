import { describe, expect, it } from "vitest";
import { SurveyRuntimeSchema } from "./survey-runtime";

const publication = {
  token: "collection-token", status: "closed", version: 2,
  expiresAt: "2026-10-01T00:00:00.000Z", questions: [],
};

const legacyRuntime = {
  id: "survey-1", title: "客户调研", tags: [], questions: [], template: { id: "report", title: "报告", sections: [] },
  version: 2, status: "closed", anonymity: "anonymous", answerRevision: 0,
  updatedAt: "2026-09-29T00:00:00.000Z", responses: [], publication, report: null,
  reportBasisVersion: null, reportGeneratedAt: null,
};

describe("survey collection batch runtime contract", () => {
  it("parses immutable batches and attributes responses to their batch", () => {
    const parsed = SurveyRuntimeSchema.parse({
      ...legacyRuntime,
      collectionBatches: [
        { ...publication, id: "batch-1", createdAt: "2026-09-20T00:00:00.000Z", closedAt: "2026-09-25T00:00:00.000Z" },
        { ...publication, token: "fresh-token", status: "collecting", id: "batch-2", createdAt: "2026-09-29T00:00:00.000Z", closedAt: null },
      ],
      activeCollectionBatchId: "batch-2",
      responses: [{ id: "answer-1", role: "未填写", companySize: "未填写", submittedAt: "2026-09-20T01:00:00.000Z", answers: [], durationSeconds: 0, quality: "normal", analysis: "included", collectionBatchId: "batch-1" }],
    });

    expect(parsed.activeCollectionBatchId).toBe("batch-2");
    expect(parsed.collectionBatches).toHaveLength(2);
    expect(parsed.responses[0]?.collectionBatchId).toBe("batch-1");
  });

  it("continues to parse a legacy runtime that only has publication", () => {
    expect(SurveyRuntimeSchema.parse(legacyRuntime).publication).toMatchObject(publication);
  });
});
