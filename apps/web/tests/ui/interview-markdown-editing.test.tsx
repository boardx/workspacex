import * as React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InterviewExpertsStep } from "@/components/itv/interview-experts-step";
import { InterviewOutlineStep } from "@/components/itv/interview-outline-step";
import { InterviewMarkdownEditingStep } from "@/components/itv/interview-markdown-editing-step";
import { MOCK_DIGITAL_EXPERTS } from "@/lib/mock/digital-expert-personas";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const source = { documentId: "edit-doc", step: "experts" as const, version: 1, contentHash: "a".repeat(64), evidenceMode: "simulated" as const, references: [], markdown: "# 专家\n" };
it("confirmed source is read-only and cannot spend a model call on regeneration", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4100"); vi.stubEnv("NEXT_PUBLIC_API_PATH_PREFIX", "");
  const posts: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (init.method === "POST") posts.push(url);
    return new Response(JSON.stringify(url.endsWith("/digital/experts") ? { items: [] } : { interviewId: "itv-edits", revisionId: "rev-edits", version: 1, documents: [source], states: [{ documentId: source.documentId, status: "confirmed", failure: null }] }));
  });
  render(<InterviewMarkdownEditingStep interviewId="itv-edits" step="experts" onVersionChange={vi.fn()} onDirtyChange={vi.fn()} onContinue={vi.fn()} />);
  expect(await screen.findByRole("status")).toHaveTextContent("只读");
  expect(screen.getByRole("textbox", { name: "专家文档 Markdown" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "生成专家建议" })).toBeDisabled();
  expect(posts).toEqual([]);
});
it("failed generation reconciles persisted partial text into a clean editor", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4100"); vi.stubEnv("NEXT_PUBLIC_API_PATH_PREFIX", "");
  let failed = false;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (init.method === "POST") { failed = true; return new Response(JSON.stringify({ message: "unavailable" }), { status: 503 }); }
    return new Response(JSON.stringify(url.endsWith("/digital/experts") ? { items: [] } : { interviewId: "itv-edits", revisionId: "rev-edits", version: failed ? 2 : 1, documents: [{ ...source, markdown: failed ? "# 已保存的部分画像" : source.markdown }], states: [{ documentId: source.documentId, status: failed ? "failed" : "draft", failure: null }] }));
  });
  render(<InterviewMarkdownEditingStep interviewId="itv-edits" step="experts" onVersionChange={vi.fn()} onDirtyChange={vi.fn()} onContinue={vi.fn()} />);
  const input = await screen.findByRole("textbox", { name: "专家文档 Markdown" });
  await vi.waitFor(() => expect(input).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "生成专家建议" }));
  await screen.findByRole("alert");
  expect(input).toHaveValue("# 已保存的部分画像");
});
it("outline controls reorder raw sibling groups and retain stable question references", () => {
  const first = "## [背景](#question-one)\n\n原文  \n\n";
  const second = "## [反例](#question-two)\n\n保留反例\n";
  const change = vi.fn();
  render(<InterviewOutlineStep document={{ ...source, step: "outline", markdown: first + second }} pending={false} onChange={change} onSave={vi.fn()} onConfirm={vi.fn()} onGenerate={vi.fn()} />);
  expect(screen.getByRole("button", { name: "上移当前分组" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "下移当前分组" }));
  expect(change).toHaveBeenCalledWith(second + first);
});
it("a save conflict does not silently rebase local text onto another editor's version", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4100"); vi.stubEnv("NEXT_PUBLIC_API_PATH_PREFIX", "");
  const writes: { expectedVersion: number; expectedDocumentVersion: number }[] = [];
  let gets = 0;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url.endsWith("/digital/experts")) return new Response(JSON.stringify({ items: [] }));
    if (init.method === "POST") { writes.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ message: "conflict" }), { status: 409 }); }
    gets++;
    return new Response(JSON.stringify({ interviewId: "itv-edits", revisionId: "rev-edits", version: gets > 1 ? 2 : 1, documents: [{ ...source, version: gets > 1 ? 2 : 1 }], states: [{ documentId: source.documentId, status: "draft", failure: null }] }));
  });
  render(<InterviewMarkdownEditingStep interviewId="itv-edits" step="experts" onVersionChange={vi.fn()} onDirtyChange={vi.fn()} onContinue={vi.fn()} />);
  const input = await screen.findByRole("textbox", { name: "专家文档 Markdown" });
  await vi.waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: "# 专家\n\n本地画像" } });
  fireEvent.click(screen.getByRole("button", { name: "保存专家草稿" }));
  await screen.findByRole("alert");
  await vi.waitFor(() => expect(screen.getByRole("button", { name: "保存专家草稿" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "保存专家草稿" }));
  await vi.waitFor(() => expect(writes).toHaveLength(2));
  expect(writes.map((write) => [write.expectedVersion, write.expectedDocumentVersion])).toEqual([[1, 1], [1, 1]]);
});
it("expert search filters the supplied directory rather than showing a fallback mock list", () => {
  render(<InterviewExpertsStep document={source} directory={MOCK_DIGITAL_EXPERTS.slice(0, 2)} pending={false} onChange={vi.fn()} onSave={vi.fn()} onConfirm={vi.fn()} onGenerate={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox", { name: "搜索专家" }), { target: { value: "不存在的夜班专家" } });
  expect(screen.getByText("没有匹配的专家")).toBeVisible();
  expect(screen.queryByRole("button", { name: /添加专家 / })).not.toBeInTheDocument();
});
it("virtual expert requires a Markdown preview and explicit review before adding", () => {
  const change = vi.fn();
  render(<InterviewExpertsStep document={source} directory={[]} pending={false} onChange={change} onSave={vi.fn()} onConfirm={vi.fn()} onGenerate={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "添加虚拟专家" }));
  fireEvent.change(screen.getByRole("textbox", { name: "专家名称" }), { target: { value: "夜班护理角色" } });
  fireEvent.change(screen.getByRole("textbox", { name: "专家画像 Markdown" }), { target: { value: "擅长交接班；不代表真实受访者。" } });
  expect(screen.getByTestId("itv-virtual-expert-preview-card")).toHaveTextContent("夜班护理角色");
  expect(screen.getByTestId("itv-virtual-expert-preview-card")).toHaveTextContent("擅长交接班；不代表真实受访者。");
  expect(screen.getByRole("button", { name: "保存并添加专家" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "已审阅画像及模拟边界" }));
  fireEvent.click(screen.getByRole("button", { name: "保存并添加专家" }));
  expect(change).toHaveBeenCalledWith(expect.stringContaining("擅长交接班；不代表真实受访者。"));
  expect(change.mock.calls[0]![0]).toContain("#expert-virtual-");
});
it("question edit preserves stable heading references and unrelated raw Markdown", () => {
  const raw = "前言\r\n\r\n## [背景](#question-q-7)\r\n\r\n最近一次发生了什么？\r\n\r\n## [反例](#question-q-8)\r\n\r\n保留 **原文**。\r\n";
  const change = vi.fn();
  render(<InterviewOutlineStep document={{ ...source, step: "outline", markdown: raw }} pending={false} onChange={change} onSave={vi.fn()} onConfirm={vi.fn()} onGenerate={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox", { name: "编辑背景" }), { target: { value: "最近一次夜班交接具体发生了什么？" } });
  const edited = change.mock.calls[0]![0] as string;
  expect(edited).toContain("## [背景](#question-q-7)\r\n");
  expect(edited.endsWith("## [反例](#question-q-8)\r\n\r\n保留 **原文**。\r\n")).toBe(true);
  expect(edited.startsWith("前言\r\n\r\n")).toBe(true);
});
it("renders ordered Markdown questions as editable rows without changing neighboring expert groups", () => {
  const raw = "## [采购](#expert-purchase)\n\n1. 谁提出采购？\n2. 谁最终否决？\n\n## [财务](#expert-finance)\n\n1. 预算谁批准？\n";
  const change = vi.fn();
  render(<InterviewOutlineStep document={{ ...source, step: "outline", markdown: raw }} pending={false} onChange={change} onSave={vi.fn()} onConfirm={vi.fn()} onGenerate={vi.fn()} />);
  const questions = screen.getByRole("list", { name: "采购访谈问题" });
  expect(questions).toBeVisible();
  fireEvent.change(within(questions).getByRole("textbox", { name: "编辑问题 2" }), { target: { value: "谁拥有最终否决权？" } });
  expect(change).toHaveBeenCalledWith(raw.replace("2. 谁最终否决？", "2. 谁拥有最终否决权？"));
  fireEvent.click(within(questions).getByRole("button", { name: "删除问题 1" }));
  expect(change).toHaveBeenCalledWith(raw.replace("1. 谁提出采购？\n", ""));
});
it("generation cannot silently discard an unsaved expert Markdown edit", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4100"); vi.stubEnv("NEXT_PUBLIC_API_PATH_PREFIX", "");
  const posts: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (init.method === "POST") posts.push(url);
    return new Response(JSON.stringify(url.endsWith("/digital/experts") ? { items: [] } : { interviewId: "itv-edits", revisionId: "rev-edits", version: 1, documents: [source], states: [{ documentId: source.documentId, status: "draft", failure: null }] }));
  });
  render(<InterviewMarkdownEditingStep interviewId="itv-edits" step="experts" onVersionChange={vi.fn()} onDirtyChange={vi.fn()} onContinue={vi.fn()} />);
  const input = await screen.findByRole("textbox", { name: "专家文档 Markdown" });
  await vi.waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: "# 专家\n\n保留待审阅的新画像。" } });
  fireEvent.click(screen.getByRole("button", { name: "生成专家建议" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("先保存");
  expect(input).toHaveValue("# 专家\n\n保留待审阅的新画像。");
  expect(posts).toEqual([]);
});
