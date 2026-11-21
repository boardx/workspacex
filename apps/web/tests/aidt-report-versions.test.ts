import { afterEach, describe, expect, it, vi } from "vitest";
import type { AidtSharedStage } from "@/features/aidt/lib/live-aidt-stages";
import { isConfirmedReportVersion, readConfirmedReportForExport } from "@/features/aidt/lib/aidt-report-versions";
import { StageDraft } from "@repo/contracts/aidt-stages";

const { history } = vi.hoisted(() => ({ history: vi.fn() }));
vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({ listAidtStageHistory: history }));
afterEach(() => vi.unstubAllGlobals());

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
  it("keeps a normally created prefixed idea linked to its exact saved revision", async () => {
    const { createAidtIdea } = await import("@/features/aidt/lib/aidt-idea-handoff");
    const { emptyAidtUiDrafts } = await import("@/features/aidt/lib/aidt-ui-drafts");
    const { aidtReportSourceLinks } = await import("@/features/aidt/lib/aidt-report-source-links");
    const id = "idea-73990275-e848-480f-8962-8d39d3b88b43", saved = stage(4, 7);
    saved.content.draft = StageDraft.parse(createAidtIdea(saved.content.draft, id, "学生点子"));
    expect(aidtReportSourceLinks(saved)).toEqual([{ id, title: "学生点子", href: `/aidt/project?step=4&entity=${id}&entityRevision=7` }]);
    expect(aidtReportSourceLinks({ ...saved, content: { schemaVersion: 1, draft: StageDraft.parse(emptyAidtUiDrafts()[4]!) } })).toEqual([]);
  });

  it("retains entity hyperlinks in actual exports and refuses a returned source from another project or stage", async () => {
    const saved = stage(4, 3), report = stage(6, 4), id = "idea-73990275-e848-480f-8962-8d39d3b88b43";
    saved.content.draft.ideas = [{ id, title: "实际入选点子", description: "学生保存的说明" }];
    report.content.reports = { "report-a": { ...confirmed, sourceStageRevisions: [{ stageId: 4, revision: 3 }] } };
    const signal = new AbortController().signal;
    history.mockReset().mockResolvedValueOnce({ items: [report] }).mockResolvedValueOnce({ items: [saved] });
    await expect(readConfirmedReportForExport("project", 4, "token", signal, "report-a")).resolves.toContain(`](/aidt/project?step=4&entity=${id}&entityRevision=3)`);
    for (const invalid of [{ ...saved, projectId: "foreign" }, { ...saved, stageId: 2 }]) {
      history.mockReset().mockResolvedValueOnce({ items: [report] }).mockResolvedValueOnce({ items: [invalid] });
      await expect(readConfirmedReportForExport("project", 4, "token", signal, "report-a")).rejects.toThrow("AIDT_REPORT_VERSION_UNAVAILABLE");
    }
  });

  it("exports absolute same-site entity links from the browser origin and keeps an honest fallback without one", async () => {
    const saved = stage(4, 3), report = stage(6, 4), id = "idea-73990275-e848-480f-8962-8d39d3b88b43";
    saved.content.draft.ideas = [{ id, title: "来源点子", description: "已保存说明" }];
    report.content.reports = { "report-a": { ...confirmed, sourceStageRevisions: [{ stageId: 4, revision: 3 }] } };
    const signal = new AbortController().signal;
    const reset = () => history.mockReset().mockResolvedValueOnce({ items: [report] }).mockResolvedValueOnce({ items: [saved] });
    vi.stubGlobal("window", { location: { origin: "https://devapp.boardx.us" } });
    reset();
    await expect(readConfirmedReportForExport("project", 4, "token", signal, "report-a")).resolves.toContain(`](https://devapp.boardx.us/aidt/project?step=4&entity=${id}&entityRevision=3)`);
    reset();
    await expect(readConfirmedReportForExport("project", 4, "token", signal, "report-a", "https://app.workspacex.cn")).resolves.toContain("](https://app.workspacex.cn/aidt/");
    vi.unstubAllGlobals();
    reset();
    await expect(readConfirmedReportForExport("project", 4, "token", signal, "report-a")).resolves.toContain("离线打开不能直接回到来源");
    for (const origin of ["javascript:alert(1)", "file:///tmp", "https://user:secret@devapp.boardx.us", "https://devapp.boardx.us/path", "https://devapp.boardx.us?redirect=evil", "https://devapp.boardx.us#section", "//evil.example", " https://devapp.boardx.us"]) {
      reset();
      const markdown = await readConfirmedReportForExport("project", 4, "token", signal, "report-a", origin);
      expect(markdown).toContain(`](/aidt/project?step=4&entity=${id}&entityRevision=3)`);
      expect(markdown).toContain("未取得可信站点地址");
      expect(markdown).not.toContain(origin);
    }
  });

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

it("links each selected Persona and HMW interview finding to the persisted source revision", async () => {
  const { aidtReportSourceLinks } = await import("@/features/aidt/lib/aidt-report-source-links");
  const saved = stage(3, 9);
  const interviewId = "73990275-e848-480f-8962-8d39d3b88b43";
  saved.sourceStageRevisions = [{ stageId: 2, revision: 4 }];
  saved.content.draft.fields = {
    definitionEvidenceRevision: "4",
    "definitionPersona:p": JSON.stringify({ id: "p", name: "肖像", archived: false, confirmed: true, cardIds: [interviewId] }),
    "definitionHmw:h": JSON.stringify({ id: "h", text: "开放式问题", archived: false, confirmed: true, cardIds: [interviewId] }),
  };
  const links = aidtReportSourceLinks(saved).filter(link => link.href.includes("step=2"));
  expect(links.map(link => link.href)).toEqual(Array(2).fill(`/aidt/project?step=2&entity=${interviewId}&entityRevision=4`));
  expect(aidtReportSourceLinks({ ...saved, sourceStageRevisions: [{ stageId: 2, revision: 5 }] }).some(link => link.href.includes("step=2"))).toBe(false);
});
