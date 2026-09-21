import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import { interview as C } from "@repo/contracts";
import { DigitalInterviewController } from "../../src/interface/controllers/digital-interview.controller";
import { toOrgId } from "../../src/domain/org-id";

describe("digital report observer process-death recovery", () => {
  it("emits an error and ends when recovery restores a report without changing updatedAt", async () => {
    const running = C.DigitalInterviewWorkflowView.parse({
      interviewId: "itv-observer-timeout", name: "Recovery interview", tags: [], topic: "Recovery",
      status: "report_pending", sourceQuickInterviewId: null, selectedExpertIds: ["expert-1"],
      reportId: "report-new", version: 8,
      scope: { kind: "none", projectId: null, researchProjectId: null }, currentStep: "report",
      revisionId: "revision-1", topicVersionId: "topic-1", expertSnapshotVersionId: "experts-1",
      questionVersionId: "questions-1", expertCandidates: [], questions: [], questionCandidates: [],
      expertRuns: [], report: null, skillThreadId: "thread-1", skillMessages: [], skillProposals: [],
      reportGeneration: {
        reportId: "report-new", requestId: "request-new", status: "running", title: "Replacement",
        executiveSummary: "Replacement summary", markdown: "Partial replacement", findings: [],
        errorCode: null, updatedAt: "2026-09-19T06:00:00.000Z",
      },
    });
    const restored = C.DigitalInterviewWorkflowView.parse({
      ...running, status: "completed", reportId: "report-old", version: 9,
      report: {
        reportId: "report-old", title: "Preserved report", executiveSummary: "Preserved summary",
        markdown: "Preserved report body", generatedAt: "2026-09-18T06:00:00.000Z",
        findings: [{ findingId: "finding-1", title: "Finding", summary: "Summary",
          expertId: "expert-1", questionId: "question-1", sourceAnswerId: "expert-1:question-1", exploratory: true }],
      },
      reportGeneration: { ...running.reportGeneration, status: "failed", errorCode: "AI_GENERATION_UNAVAILABLE" },
    });
    const get = vi.fn().mockResolvedValueOnce(running).mockResolvedValue(restored);
    const deps = [{}, {}, {}, {}, {}, {}, {}, {}, { get }] as unknown as ConstructorParameters<typeof DigitalInterviewController>;
    const controller = new DigitalInterviewController(...deps);
    const frames: unknown[] = [];
    const end = vi.fn();
    const response = {
      destroyed: false, writableEnded: false, writeHead: vi.fn(), end,
      write: vi.fn((frame: string) => { frames.push(JSON.parse(frame)); return true; }),
    } as unknown as Response;

    await controller.observeReportStream(
      { userId: "observer-user", orgId: toOrgId("org-observer-timeout") }, running.interviewId, response,
    );

    expect(restored.reportGeneration?.updatedAt).toBe(running.reportGeneration?.updatedAt);
    expect(get).toHaveBeenCalledTimes(2);
    expect(frames).toEqual([
      expect.objectContaining({ type: "snapshot", seq: 0, status: "running", markdown: "Partial replacement" }),
      { type: "error", seq: 1, reasonCode: "AI_GENERATION_UNAVAILABLE" },
    ]);
    expect(end).toHaveBeenCalledTimes(1);
  });
});
