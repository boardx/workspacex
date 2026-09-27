import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InterviewExpertsStep } from "@/components/itv/interview-experts-step";
import { InterviewOutlineStep } from "@/components/itv/interview-outline-step";
import { InterviewMarkdownEditingStep } from "@/components/itv/interview-markdown-editing-step";
import { MOCK_DIGITAL_EXPERTS } from "@/lib/mock/digital-expert-personas";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const source = { documentId: "edit-doc", step: "experts" as const, version: 1, contentHash: "a".repeat(64), evidenceMode: "simulated" as const, references: [], markdown: "# 专家\n" };
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
