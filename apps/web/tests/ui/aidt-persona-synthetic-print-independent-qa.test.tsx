import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { canvas } from "@repo/contracts";
import { SharedStage } from "@repo/contracts/aidt-stages";
import { AidtDefinitionOutput } from "@/features/aidt/components/aidt-definition";
import { AidtPersonaCanvasPreview } from "@/features/aidt/components/aidt-persona-canvas-preview";
import { addAidtPersonaCandidate, collectAidtPersonaCandidates } from "@/features/aidt/lib/aidt-persona-candidates";
import { aidtEntityReportLines } from "@/features/aidt/lib/aidt-entity-report";
import { aidtUiReportMarkdown, aidtUiStageMarkdown, emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";

// Only the raster-rendering and print-window boundaries are replaced. Saved source,
// template parsing, metadata projection, output wrapper and print action are real.
const mocks = vi.hoisted(() => ({ api: vi.fn(), pdf: vi.fn(), png: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiRequest: mocks.api }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: { currentOrgId: "qa-org", userId: "qa-user", sessionToken: "qa-token" } }) }));
vi.mock("@/features/aidt/lib/aidt-print-preview", () => ({ previewAidtPdf: mocks.pdf, previewAidtText: vi.fn() }));
vi.mock("@/components/canvas/canvas-stage", async () => {
  const React = await import("react");
  return { CanvasStage: React.forwardRef(function RendererBoundary(props: { markdown: string }, ref) {
    React.useImperativeHandle(ref, () => ({ exportPNG: mocks.png, fitToContent: () => undefined }));
    return <div data-testid="qa-canvas-render-boundary">{props.markdown}</div>;
  }) };
});
const projectId = "qa-persona-project", interviewId = "41818f43-6991-4f8c-a0a3-c46ea2019d38";
const card = { id: interviewId, participantCode: "U01", headlineKind: "student-summary" as const, headline: "合成材料：午休先比较口味", context: "合成购买情境", quote: "", sourceRef: "合成软件测试", photoRef: "" };
const code = "模板: persona\n## 需求\n- 保留口味比较的不确定性";
const template = canvas.operations.listTemplates.out.parse({ templates: [{ key: "persona", displayName: "后台用户画像模板", version: 2, status: "published", builtin: true, visibility: "org-wide", underlyingType: "canvas",
  sections: [{ sectionId: "qa-need", name: "需求", type: "长文本", order: 0, required: true, capacity: null }], usageCount: 0, tags: [], title: "后台用户画像", footer: "", promptText: "", recommendAfter: [], size: "A1", gridCols: 12, gridRows: 8, platform: false, layoutSource: "user-edited", createdAt: "2026-11-22T07:00:00Z", updatedAt: "2026-11-22T07:00:00Z" }] }).templates[0]!;
const source = { orgId: "qa-org", projectId, revision: 2, definitionRevision: 7, cardIds: [interviewId], syntheticCardIds: [interviewId] };
const fields = { [`interviewConfirmed:${interviewId}`]: "true", [`interviewRecord:${interviewId}`]: JSON.stringify({ version: 1, id: interviewId, code: "U01", topic: "点单过程", topicRevision: 1, goal: "了解故事", original: "请说说经过？", adopted: "请回忆最近一次经过？", guideConfirmed: true, consent: { notes: true, audio: false, photos: false, observedAt: "2026-11-22T07:00:00Z" } }) };
const stage = SharedStage.parse({ projectId, stageId: 2, revision: 2, sourceStageRevisions: [], updatedBy: "qa-user", updatedAt: "2026-11-22T07:00:00Z", content: { schemaVersion: 1, draft: { fields, ideas: [], selectedIdeaId: "", discoveryCards: [card] } } });
const originalDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "decode");
beforeEach(() => {
  vi.clearAllMocks(); mocks.pdf.mockResolvedValue("cancelled");
  mocks.png.mockReturnValue({ dataUrl: "data:image/png;base64,iVBORw0KGgo=", width: 1200, height: 800 });
  Object.defineProperty(HTMLImageElement.prototype, "decode", { configurable: true, value: vi.fn(async () => undefined) });
  mocks.api.mockImplementation(async (url: string) => {
    if (url === `/projects/${projectId}/aidt/stages/2`) return { stage };
    throw new Error(`Unexpected source request ${url}`);
  });
});
afterEach(() => { cleanup(); if (originalDecode) Object.defineProperty(HTMLImageElement.prototype, "decode", originalDecode); else Reflect.deleteProperty(HTMLImageElement.prototype, "decode"); });

it("keeps saved persona synthetic origin through its actual template output, print wrapper and report projections", async () => {
  const proposal = { kind: "persona", name: "合成测试画像", situation: "午休", behavior: "比较口味", need: "清楚辨别", limits: "不是实际访谈", cardIds: [interviewId] };
  const candidates = await collectAidtPersonaCandidates({ source, template, threadId: "qa-thread", messages: [{ id: "qa-assistant", role: "assistant", content: "```aidt-definition\n" + JSON.stringify(proposal) + "\n```\n```canvas\n" + code + "\n```" }] });
  expect(candidates).toHaveLength(1);
  const empty = emptyAidtUiDrafts()[3]!;
  const draft = addAidtPersonaCandidate({ ...empty, fields: { surpriseStatus: "none", surpriseConfirmed: "true" } }, candidates[0]!, [card], 2);
  expect(draft).not.toBe(empty);
  const view = render(<AidtDefinitionOutput projectId={projectId} draft={draft} update={() => undefined} readOnly={false} availableCards={[card]} availableCardsRevision={2} discoveryCardFields={fields} entityId={candidates[0]!.id} />);
  await waitFor(() => expect(screen.getByTestId("aidt-persona-canvas-preview")).toBeInTheDocument());
  expect(screen.getByRole("region", { name: "当前产物" })).toHaveTextContent(/非真人/);
  expect(screen.getByTestId("qa-canvas-render-boundary")).toHaveTextContent("需求");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "打印画像" })); });
  expect(mocks.pdf).toHaveBeenCalledOnce();
  const [printed, , options] = mocks.pdf.mock.calls[0]!;
  expect(printed as HTMLElement).toHaveTextContent(/非真人/);
  expect((printed as HTMLElement).querySelector("img")).toHaveAttribute("alt", "用户画像画布完整内容");
  expect(options).toMatchObject({ defaultPaper: "A1", layout: "flow" });
  expect(options.isCurrent()).toBe(true);
  const all = emptyAidtUiDrafts(); all[3] = draft;
  for (const text of [aidtEntityReportLines(3, draft, [], projectId).join("\n"), aidtUiStageMarkdown(3, draft), aidtUiReportMarkdown(all)]) {
    expect(text).toContain(proposal.name); expect(text).toMatch(/非真人/);
  }
  view.unmount(); expect(options.isCurrent()).toBe(false);
});

it("preserves the ordinary canvas print layout when no synthetic source notice is present", async () => {
  render(<AidtPersonaCanvasPreview template={template} code={code} />);
  await screen.findByTestId("aidt-persona-canvas-preview");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "打印画像" })); });
  expect(mocks.pdf).toHaveBeenCalledOnce();
  const [printed, , options] = mocks.pdf.mock.calls[0]!;
  expect((printed as HTMLElement).querySelectorAll("img")).toHaveLength(1);
  expect(printed as HTMLElement).not.toHaveTextContent(/非真人/);
  expect(options).toMatchObject({ defaultPaper: "A1", layout: "canvas", canvasSize: { width: 1200, height: 800 } });
});

it("does not print a prepared image after its source notice changes", async () => {
  let release!: () => void;
  const decoding = new Promise<void>(resolve => { release = resolve; });
  Object.defineProperty(HTMLImageElement.prototype, "decode", { configurable: true, value: vi.fn(() => decoding) });
  const view = render(<AidtPersonaCanvasPreview template={template} code={code} sourceNotice="合成音频 · 非真人访谈" />);
  await screen.findByTestId("aidt-persona-canvas-preview");
  fireEvent.click(screen.getByRole("button", { name: "打印画像" }));
  await waitFor(() => expect(mocks.png).toHaveBeenCalledOnce());
  view.rerender(<AidtPersonaCanvasPreview template={template} code={code} sourceNotice="当前来源待重新核对" />);
  await act(async () => { release(); });
  expect(mocks.pdf).not.toHaveBeenCalled();
});
