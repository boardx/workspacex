import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InterviewCreatePage } from "@/components/itv/interview-create-page";
import type { InterviewMarkdownEnvelope } from "@/lib/interview-markdown-api";
const mocks = vi.hoisted(() => ({ push: vi.fn(), create: vi.fn(), initializeInterviewMarkdown: vi.fn(), saveInterviewMarkdown: vi.fn(), confirmInterviewMarkdown: vi.fn(), generateInterviewMarkdown: vi.fn(), uploadInterviewMarkdownAttachment: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/live-interview-metadata", () => ({ createDigitalInterviewDraft: mocks.create }));
vi.mock("@/lib/interview-markdown-api", () => mocks);
const markdown = "# 夜班交接研究\n\n保留 **用户原话** 与[资料](#source-night)。";
const empty: InterviewMarkdownEnvelope = { interviewId: "new-source-7", revisionId: "revision-new-7", version: 1, documents: [], states: [], execution: null, review: null };
const saved: InterviewMarkdownEnvelope = { ...empty, version: 2, documents: [{ documentId: "intake-7", step: "intake", version: 1, markdown, contentHash: "a".repeat(64), evidenceMode: "simulated", references: [] }], states: [{ documentId: "intake-7", status: "draft", failure: null }] };
const confirmed: InterviewMarkdownEnvelope = { ...saved, version: 3, states: [{ documentId: "intake-7", status: "confirmed", failure: null }] };
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.create.mockResolvedValue({ interviewId: "new-source-7" });
  mocks.initializeInterviewMarkdown.mockResolvedValue(empty);
  mocks.saveInterviewMarkdown.mockResolvedValue(saved);
  mocks.confirmInterviewMarkdown.mockResolvedValue(confirmed);
  mocks.generateInterviewMarkdown.mockResolvedValue({ ...confirmed, version: 4 });
});
afterEach(cleanup);
function enterDemand() {
  fireEvent.change(screen.getByRole("textbox", { name: "访谈名称" }), { target: { value: "夜班研究" } });
  fireEvent.change(screen.getByRole("textbox", { name: "研究需求 Markdown" }), { target: { value: markdown } });
}
it("creates project-scoped identity metadata and saves the research body only as canonical Markdown", async () => {
  render(<InterviewCreatePage projectId="project-night" />); enterDemand();
  fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/itv/new-source-7/intake"));
  expect(mocks.create).toHaveBeenCalledWith({ name: "夜班研究", tags: [], scope: { kind: "project", projectId: "project-night", researchProjectId: null }, requestId: expect.any(String) });
  const metadata = mocks.create.mock.calls[0]![0];
  expect(Object.keys(metadata).sort()).toEqual(["name", "requestId", "scope", "tags"]);
  expect(mocks.saveInterviewMarkdown).toHaveBeenCalledWith("new-source-7", "intake", { markdown, expectedVersion: 1, expectedDocumentVersion: 0 });
  expect(mocks.confirmInterviewMarkdown).not.toHaveBeenCalled();
  expect(mocks.generateInterviewMarkdown).not.toHaveBeenCalled();
});
it("confirms the saved Markdown version before generating analysis and opening its route", async () => {
  render(<InterviewCreatePage />); enterDemand();
  fireEvent.click(screen.getByRole("button", { name: "下一步：确认分析" }));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/itv/new-source-7/analysis"));
  expect(mocks.confirmInterviewMarkdown).toHaveBeenCalledWith("new-source-7", "intake", { expectedVersion: 2, expectedDocumentVersion: 1 });
  expect(mocks.generateInterviewMarkdown).toHaveBeenCalledWith("new-source-7", "analysis", { expectedVersion: 3, expectedDocumentVersion: 0 });
  expect(mocks.saveInterviewMarkdown.mock.invocationCallOrder[0]).toBeLessThan(mocks.confirmInterviewMarkdown.mock.invocationCallOrder[0]!);
  expect(mocks.confirmInterviewMarkdown.mock.invocationCallOrder[0]).toBeLessThan(mocks.generateInterviewMarkdown.mock.invocationCallOrder[0]!);
});
it("retry after failed analysis keeps the same interview and confirmed original text", async () => {
  mocks.initializeInterviewMarkdown.mockResolvedValueOnce(empty).mockResolvedValue(confirmed);
  mocks.generateInterviewMarkdown.mockRejectedValueOnce(new Error("model unavailable")).mockResolvedValue({ ...confirmed, version: 4 });
  render(<InterviewCreatePage projectId="project-night" />); enterDemand();
  fireEvent.click(screen.getByRole("button", { name: "下一步：确认分析" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("不会重复创建");
  expect(screen.getByRole("textbox", { name: "研究需求 Markdown" })).toHaveValue(markdown);
  expect(screen.getByRole("textbox", { name: "研究需求 Markdown" })).toHaveAttribute("readonly");
  expect(screen.getByRole("button", { name: "进入已保存访谈" })).toBeEnabled();
  expect(mocks.push).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByRole("button", { name: "下一步：确认分析" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "下一步：确认分析" }));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/itv/new-source-7/analysis"));
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.saveInterviewMarkdown).toHaveBeenCalledTimes(1);
  expect(mocks.confirmInterviewMarkdown).toHaveBeenCalledTimes(1);
  expect(mocks.initializeInterviewMarkdown.mock.calls.map(([id]) => id)).toEqual(["new-source-7", "new-source-7"]);
});
it("file upload first saves editable Markdown then appends only the server saved draft, without confirming", async () => {
  const imported = `${markdown}\n\n## 导入材料\n\n| a |\n|---|\n| b |`;
  mocks.uploadInterviewMarkdownAttachment.mockResolvedValue({ source: { ...saved, version: 3, documents: [{ ...saved.documents[0], markdown: imported, version: 2 }] } });
  render(<InterviewCreatePage />); enterDemand();
  const file = new File(["a\nb"], "研究.csv", { type: "text/csv" });
  fireEvent.change(screen.getByLabelText("导入研究文件"), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByRole("textbox", { name: "研究需求 Markdown" })).toHaveValue(imported));
  expect(mocks.uploadInterviewMarkdownAttachment).toHaveBeenCalledWith("new-source-7", file, { expectedVersion: 2, expectedDocumentVersion: 1 });
  expect(mocks.saveInterviewMarkdown.mock.invocationCallOrder[0]).toBeLessThan(mocks.uploadInterviewMarkdownAttachment.mock.invocationCallOrder[0]!);
  expect(mocks.confirmInterviewMarkdown).not.toHaveBeenCalled();
  expect(mocks.generateInterviewMarkdown).not.toHaveBeenCalled();
  expect(mocks.push).not.toHaveBeenCalled();
});
