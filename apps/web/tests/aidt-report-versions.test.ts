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

describe("exact AIDT report source links", () => {
  it("opens the saved interview version and scopes the transcript location to its own material", async () => {
    const { aidtReportSourceLinks } = await import("@/features/aidt/lib/aidt-report-source-links");
    const id = "73990275-e848-480f-8962-8d39d3b88b43";
    const saved = stage(2, 9);
    const sourceKey = `interviewMaterial:${id}:clip`;
    const material = {
      projectId: "project", runId: "run", artifactId: "quote-file", versionId: "file-v2",
      name: "转写", mime: "text/plain", sha256: "1".repeat(64), bytes: 120,
    };
    saved.content.draft.fields = {
      [`interviewRecord:${id}`]: JSON.stringify({ version: 1, id, code: "U01" }),
      [`interviewTranscript:${id}`]: JSON.stringify({ sourceKey, locator: "01:42", checked: true }),
      [sourceKey]: JSON.stringify(material),
    };
    const href = aidtReportSourceLinks(saved)[0]?.href ?? "";
    const url = new URL(href, "https://local.example");
    expect(url.pathname).toBe("/aidt/project");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      step: "2", entity: id, entityRevision: "9", sourceId: "quote-file", timestamp: "01:42",
    });
    saved.content.draft.fields[sourceKey] = JSON.stringify({ ...material, projectId: "another-group" });
    expect(aidtReportSourceLinks(saved)[0]?.href).not.toContain("quote-file");
  });

  it("keeps legacy cards and contradictory entity identifiers at stage-revision fallback", async () => {
    const { aidtReportSourceLinks } = await import("@/features/aidt/lib/aidt-report-source-links");
    const legacy = stage(2, 5);
    const id = "783bb5b5-794b-47a2-a59d-57d29d7e6931";
    legacy.content.draft.fields = {
      "interviewRecord:other-id": JSON.stringify({ version: 1, id, code: "U01" }),
      definitionHmwId: id,
    };
    expect(aidtReportSourceLinks(legacy)).toEqual([]);
    const def = stage(3, 8);
    const common = { id, confirmed: true, archived: false, cardIds: [] };
    def.content.draft.fields = {
      [`definitionPersona:${id}`]: JSON.stringify({ ...common, name: "画像" }),
      [`definitionHmw:${id}`]: JSON.stringify({ ...common, text: "问题" }),
    };
    expect(aidtReportSourceLinks(def)).toEqual([]);
  });
});
