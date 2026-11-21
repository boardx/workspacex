import { describe, expect, it, vi } from "vitest";
import type { AidtSharedStage } from "@/features/aidt/lib/live-aidt-stages";
import { isConfirmedReportVersion, readConfirmedReportForExport } from "@/features/aidt/lib/aidt-report-versions";

const { history } = vi.hoisted(() => ({ history: vi.fn() }));
vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({ listAidtStageHistory: history }));

const firstSource = { stageId: 1, revision: 2 };
const confirmed = { markdown: "# 第一份报告", sourceStageRevisions: [firstSource], confirmedAtRevision: 4 };
const laterDraft = { markdown: "# 第二份报告草稿", sourceStageRevisions: [firstSource] };
function stage(stageId: number, revision: number): AidtSharedStage {
  return {
    projectId: "project", stageId, revision, updatedAt: "2026-11-21T00:00:00Z", updatedBy: "student",
    sourceStageRevisions: [],
    content: { schemaVersion: 1, draft: { fields: {}, ideas: [], selectedIdeaId: "" } },
  };
}

describe("confirmed AIDT report exports", () => {
  it("exports exact authorized records and scopes confirmation to the report entity", async () => {
    const report = stage(6, 4);
    report.content.reports = { "report-a": confirmed, "report-b": laterDraft };
    expect(isConfirmedReportVersion(report, "report-a")).toBe(true);
    expect(isConfirmedReportVersion(report, "report-b")).toBe(false);
    expect(isConfirmedReportVersion({ ...report, revision: 5 }, "report-a")).toBe(false);
    const signal = new AbortController().signal;
    history.mockReset().mockResolvedValueOnce({ items: [report] }).mockResolvedValueOnce({ items: [stage(1, 2)] });
    const exported = await readConfirmedReportForExport("project", 4, "token", signal, "report-a");
    expect(history.mock.calls).toEqual([
      ["project", 6, "token", { beforeRevision: 5, limit: 1 }, signal],
      ["project", 1, "token", { beforeRevision: 3, limit: 1 }, signal],
    ]);
    expect(exported).toContain("第一份报告");
    expect(exported).toContain("第 1 步 V2");
    expect(exported).not.toContain("第二份报告草稿");
  });

  it("stops export when a source is unavailable and can retry the same version", async () => {
    const report = stage(6, 4);
    report.content.reports = { "report-a": confirmed };
    const signal = new AbortController().signal;
    history.mockReset().mockResolvedValueOnce({ items: [report] }).mockRejectedValueOnce(new Error("denied"));
    await expect(readConfirmedReportForExport("project", 4, "token", signal, "report-a")).rejects.toThrow("denied");
    history.mockReset().mockResolvedValueOnce({ items: [report] }).mockResolvedValueOnce({ items: [stage(1, 2)] });
    await expect(readConfirmedReportForExport("project", 4, "token", signal, "report-a")).resolves.toContain("报告 V4");
  });
});
