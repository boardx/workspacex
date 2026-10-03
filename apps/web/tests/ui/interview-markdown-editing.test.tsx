import { runInterviewGeneration } from "@/lib/interview-generation-session";
import * as React from "react";
import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InterviewExpertsStep } from "@/components/itv/interview-experts-step";
import { InterviewOutlineStep, normalizeOutlineForPersistence } from "@/components/itv/interview-outline-step";
import { InterviewMarkdownEditingStep, generationUnavailableMessage } from "@/components/itv/interview-markdown-editing-step";
import { EXPERT_SPECIALTY_ICON_CATEGORIES } from "@/components/itv/expert-specialty-icon";
import { INTERVIEW_PERSONA_CATEGORIES, INTERVIEW_PERSONAS } from "@/lib/interview-personas/persona-library";
import { MOCK_DIGITAL_EXPERTS, toDigitalExpertCatalogRow } from "@/lib/mock/digital-expert-personas";
import { interviewMarkdown } from "@repo/contracts";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const source = { documentId: "edit-doc", step: "experts" as const, version: 1, contentHash: "a".repeat(64), evidenceMode: "simulated" as const, references: [], markdown: "# 专家\n" };
it("matches unavailable recovery copy to the failed generation step", () => {
  expect(generationUnavailableMessage("experts")).toContain("未能生成专家建议");
  expect(generationUnavailableMessage("experts")).toContain("重新生成专家");
  expect(generationUnavailableMessage("experts")).not.toContain("重新生成问题");
  expect(generationUnavailableMessage("outline")).toContain("未能生成访谈问题");
  expect(generationUnavailableMessage("outline")).toContain("重新生成问题");
});
it("keeps each maintained category paired with a specialty icon without inventing missing records", () => {
  expect(INTERVIEW_PERSONAS).toHaveLength(97);
  expect(EXPERT_SPECIALTY_ICON_CATEGORIES.sort()).toEqual([...INTERVIEW_PERSONA_CATEGORIES].sort());
  expect(new Set(INTERVIEW_PERSONAS.map((persona) => persona.id)).size).toBe(INTERVIEW_PERSONAS.length);
});
it("confirmed source is read-only and cannot spend a model call on regeneration", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4100"); vi.stubEnv("NEXT_PUBLIC_API_PATH_PREFIX", "");
  const posts: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (init.method === "POST") posts.push(url);
    return new Response(JSON.stringify(url.endsWith("/digital/experts") ? { items: [] } : { interviewId: "itv-edits", revisionId: "rev-edits", version: 1, documents: [source], states: [{ documentId: source.documentId, status: "confirmed", failure: null }] }));
  });
  const receivedVersion = vi.fn();
  render(<InterviewMarkdownEditingStep interviewId="itv-edits" step="experts" onVersionChange={receivedVersion} onDirtyChange={vi.fn()} onContinue={vi.fn()} />);
  await waitFor(() => expect(receivedVersion).toHaveBeenCalledWith(1));
  expect(screen.getByRole("button", { name: "添加画像 张浩宇" })).toBeDisabled();
  expect(screen.queryByRole("textbox", { name: "专家文档 Markdown" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "生成专家建议" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "保存专家草稿" })).not.toBeInTheDocument();
  expect(posts).toEqual([]);
});
it("keeps the complete failed Markdown visible when one expert heading parses", () => {
  const partial = "## [夜班护理角色](#expert-night-shift)\n\n专业角色：夜班护理。\n\n" + "未完成的材料边界与局限。".repeat(24);
  render(<InterviewExpertsStep document={{ ...source, markdown: partial }} directory={[]} showRecoveryContext pending={false} onChange={vi.fn()} onSave={vi.fn()} onConfirm={vi.fn()} onGenerate={vi.fn()} />);
  expect(screen.getByText("已选择专家 1")).toBeVisible();
  expect(screen.getByTestId("itv-expert-draft-context").querySelector("pre")?.textContent).toBe(partial);
  expect(screen.queryByRole("textbox", { name: "专家文档 Markdown" })).not.toBeInTheDocument();
});
it("outline controls reorder raw sibling groups and retain stable question references", () => {
  const first = "## [采购专家](#expert-purchase)\n\n1. 谁提出采购？\n\n";
  const second = "## [财务专家](#expert-finance)\n\n1. 谁批准预算？\n";
  const change = vi.fn();
  render(<InterviewOutlineStep document={{ ...source, step: "outline", markdown: first + second }} pending={false} onChange={change} onSave={vi.fn()} onConfirm={vi.fn()} onGenerate={vi.fn()} />);
  expect(screen.getByRole("button", { name: "上移专家 采购专家" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "下移专家 采购专家" }));
  expect(change).toHaveBeenCalledWith(second + first);
});
it("shows every expert question group and uses the left rail only as a scroll shortcut", () => {
  const scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
  const markdown = "## [教师](#expert-teacher)\n\n1. 最近一次备课发生了什么？\n\n## [校长](#expert-principal)\n\n1. 请给出一个具体反例。\n";
  render(<InterviewOutlineStep document={{ ...source, step: "outline", markdown }} pending={false} onChange={vi.fn()} onSave={vi.fn()} onConfirm={vi.fn()} onGenerate={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "教师" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "校长" })).toBeVisible();
  expect(screen.getByDisplayValue("最近一次备课发生了什么？")).toBeVisible();
  expect(screen.getByDisplayValue("请给出一个具体反例。")).toBeVisible();
  expect(screen.queryByRole("button", { name: "删除该专家问题" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "校长" }));
  expect(screen.getByRole("button", { name: "校长" })).toHaveAttribute("aria-current", "true");
  expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
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
  await vi.waitFor(() => expect(screen.getByRole("button", { name: "添加画像 张浩宇" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "添加画像 张浩宇" }));
  fireEvent.click(screen.getByRole("button", { name: "确认专家并生成问题" }));
  await screen.findByRole("alert");
  await vi.waitFor(() => expect(screen.getByRole("button", { name: "确认专家并生成问题" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "确认专家并生成问题" }));
  await vi.waitFor(() => expect(writes).toHaveLength(2));
  expect(writes.map((write) => [write.expectedVersion, write.expectedDocumentVersion])).toEqual([[1, 1], [1, 1]]);
});
it("retries the failed outline after expert confirmation instead of regenerating immutable experts", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4100"); vi.stubEnv("NEXT_PUBLIC_API_PATH_PREFIX", "");
  const expertMarkdown = "## [张浩宇](#expert-one)\n\n专业角色：AI 专家\n";
  const expertDocument = { ...source, markdown: expertMarkdown };
  const outlineDocument = { ...source, documentId: "outline-doc", step: "outline" as const, markdown: "" };
  const draft = { interviewId: "itv-retry", revisionId: "rev-retry", version: 1, documents: [expertDocument, outlineDocument], states: [{ documentId: expertDocument.documentId, status: "draft", failure: null }, { documentId: outlineDocument.documentId, status: "draft", failure: null }] };
  const confirmed = { ...draft, version: 2, states: [{ documentId: expertDocument.documentId, status: "confirmed", failure: null }, { documentId: outlineDocument.documentId, status: "draft", failure: null }] };
  const generated = { ...confirmed, version: 3, documents: [expertDocument, { ...outlineDocument, markdown: "## [张浩宇](#expert-one)\n\n1. 最近一次使用 AI 发生了什么？" }] };
  let outlineCalls = 0;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    if (url.endsWith("/digital/experts")) return new Response(JSON.stringify({ items: [] }));
    if (url.endsWith("/experts/confirm")) return new Response(JSON.stringify(confirmed));
    if (url.endsWith("/outline/generate")) {
      outlineCalls += 1;
      return outlineCalls === 1
        ? new Response(JSON.stringify({ error: "dependency_unavailable", reasonCode: "AI_GENERATION_UNAVAILABLE" }), { status: 503 })
        : new Response(JSON.stringify(generated));
    }
    return new Response(JSON.stringify(outlineCalls ? confirmed : draft));
  });
  const onContinue = vi.fn();
  render(<InterviewMarkdownEditingStep interviewId="itv-retry" step="experts" onVersionChange={vi.fn()} onDirtyChange={vi.fn()} onContinue={onContinue} />);
  await vi.waitFor(() => expect(screen.getByRole("button", { name: "确认专家并生成问题" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "确认专家并生成问题" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("AI 服务暂时不可用");
  expect(screen.getByRole("alert")).toHaveTextContent("专家选择与当前编辑均已保留");
  fireEvent.click(screen.getByRole("button", { name: "重新生成问题" }));
  await vi.waitFor(() => expect(outlineCalls).toBe(2));
  await vi.waitFor(() => expect(onContinue).toHaveBeenCalledWith("outline"));
});
it("offers a safe return to expert selection when outline generation is unavailable", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4100"); vi.stubEnv("NEXT_PUBLIC_API_PATH_PREFIX", "");
  const expertDocument = { ...source, markdown: "## [张浩宇](#expert-one)\n\n专业角色：AI 专家\n" };
  const outlineDocument = { ...source, documentId: "outline-doc", step: "outline" as const, markdown: "" };
  const envelope = { interviewId: "itv-outline-recovery", revisionId: "rev-outline-recovery", version: 2, documents: [expertDocument, outlineDocument], states: [{ documentId: expertDocument.documentId, status: "confirmed", failure: null }, { documentId: outlineDocument.documentId, status: "draft", failure: null }] };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    if (url.endsWith("/digital/experts")) return new Response(JSON.stringify({ items: [] }));
    if (url.endsWith("/outline/generate") && init.method === "POST") return new Response(JSON.stringify({ error: "dependency_unavailable", reasonCode: "AI_GENERATION_UNAVAILABLE" }), { status: 503 });
    return new Response(JSON.stringify(envelope));
  });
  const onContinue = vi.fn();
  render(<InterviewMarkdownEditingStep interviewId="itv-outline-recovery" step="outline" onVersionChange={vi.fn()} onDirtyChange={vi.fn()} onContinue={onContinue} />);
  await vi.waitFor(() => expect(screen.getByRole("button", { name: "生成访谈问题" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "生成访谈问题" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("AI 服务暂时不可用");
  fireEvent.click(screen.getByRole("button", { name: "返回专家选择" }));
  expect(onContinue).toHaveBeenCalledWith("experts");
});
it("expert search filters the maintained simulation library without impersonating the live directory", () => {
  render(<InterviewExpertsStep document={source} directory={[]} pending={false} onChange={vi.fn()} onSave={vi.fn()} onConfirm={vi.fn()} onGenerate={vi.fn()} />);
  expect(screen.getByText("97 位模拟画像")).toBeVisible();
  expect(within(screen.getByTestId("itv-persona-card-persona-68ecb1289191bb24396f9bd4")).getByRole("img", { name: "张浩宇的插画头像" })).toBeVisible();
  expect(screen.getByRole("button", { name: "添加画像 张浩宇" })).toBeVisible();
  fireEvent.change(screen.getByRole("textbox", { name: "搜索专家" }), { target: { value: "不存在的夜班专家" } });
  expect(screen.getByText("没有匹配的专家")).toBeVisible();
  expect(screen.queryByRole("button", { name: /添加画像 / })).not.toBeInTheDocument();
});
it("does not claim there are no expert matches when an organization expert matches the search", () => {
  const published = { ...toDigitalExpertCatalogRow(MOCK_DIGITAL_EXPERTS[0]!), expertId: "organization-only", displayName: "唯一组织专家" };
  render(<InterviewExpertsStep document={source} directory={[published]} pending={false} onChange={vi.fn()} onSave={vi.fn()} onConfirm={vi.fn()} onGenerate={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox", { name: "搜索专家" }), { target: { value: "唯一组织专家" } });
  expect(screen.getByRole("button", { name: "添加专家 唯一组织专家" })).toBeVisible();
  expect(screen.queryByText("没有匹配的模拟画像")).not.toBeInTheDocument();
  expect(screen.queryByText("没有匹配的专家")).not.toBeInTheDocument();
});
it("distinguishes an empty published expert catalog from a search with no matches", () => {
  render(<InterviewExpertsStep document={source} directory={[]} pending={false} onChange={vi.fn()} onSave={vi.fn()} onConfirm={vi.fn()} onGenerate={vi.fn()} />);
  expect(screen.getByTestId("itv-expert-directory-empty")).toHaveTextContent("当前组织暂无可用的已发布专家");
  expect(screen.getByRole("button", { name: "添加画像 张浩宇" })).toBeVisible();
  expect(screen.queryByText("没有匹配的专家")).not.toBeInTheDocument();
});
it("lets a researcher browse all maintained personas through category filtering and pagination", () => {
  render(<InterviewExpertsStep document={source} directory={[]} pending={false} onChange={vi.fn()} onSave={vi.fn()} onConfirm={vi.fn()} onGenerate={vi.fn()} />);
  expect(screen.getByText("97 位模拟画像")).toBeVisible();
  expect(screen.getAllByRole("button", { name: /添加画像 / })).toHaveLength(9);
  fireEvent.change(screen.getByRole("combobox", { name: "专家领域" }), { target: { value: "商业专家" } });
  expect(screen.queryByRole("button", { name: "添加画像 张浩宇" })).not.toBeInTheDocument();
  expect(screen.getByText("5 位模拟画像")).toBeVisible();
  fireEvent.change(screen.getByRole("combobox", { name: "专家领域" }), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "下一页画像" }));
  expect(screen.getByText("第 2 / 11 页")).toBeVisible();
});
it("does not describe the expert directory as empty before the catalog response arrives", () => {
  render(<InterviewExpertsStep document={source} directory={[]} directoryStatus="loading" pending={false} onChange={vi.fn()} onSave={vi.fn()} onConfirm={vi.fn()} onGenerate={vi.fn()} />);
  expect(screen.getByTestId("itv-expert-directory-loading")).toHaveTextContent("正在载入专家库");
  expect(screen.queryByTestId("itv-expert-directory-empty")).not.toBeInTheDocument();
});
it("shows a retryable catalog error without replacing saved expert Markdown", () => {
  const retry = vi.fn();
  render(<InterviewExpertsStep document={source} directory={[]} directoryStatus="error" pending={false} onRetryDirectory={retry} onChange={vi.fn()} onSave={vi.fn()} onConfirm={vi.fn()} onGenerate={vi.fn()} />);
  expect(screen.getByTestId("itv-expert-directory-error")).toHaveTextContent("专家库载入失败");
  expect(screen.getByRole("button", { name: "添加画像 张浩宇" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "重试载入专家库" }));
  expect(retry).toHaveBeenCalledTimes(1);
});
it("adds a maintained persona as a stable Markdown-only simulated expert", () => {
  const change = vi.fn();
  render(<InterviewExpertsStep document={source} directory={[]} pending={false} onChange={change} onSave={vi.fn()} onConfirm={vi.fn()} onGenerate={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "添加画像 张浩宇" }));
  const markdown = change.mock.calls[0]![0] as string;
  expect(markdown).toContain("## [张浩宇](#expert-persona-68ecb1289191bb24396f9bd4)");
  expect(markdown).toContain("模拟画像");
  expect(markdown).not.toContain("mock-persona:");
  expect(screen.queryByText("审阅与编辑专家画像 Markdown")).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "专家文档 Markdown" })).not.toBeInTheDocument();
});
it("virtual expert requires a Markdown preview and explicit review before adding", () => {
  const change = vi.fn();
  render(<InterviewExpertsStep document={source} directory={[]} pending={false} onChange={change} onSave={vi.fn()} onConfirm={vi.fn()} onGenerate={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "添加虚拟专家" }));
  for (const [label, value] of Object.entries({ 专家名称: "夜班护理角色", 专业角色: "护士长", 专业领域: "护理管理", 研究关注: "夜班交接班", 观点风格: "审慎务实", 简介: "擅长交接班；不代表真实受访者。", 局限与材料边界: "无真实访谈记录" })) {
    fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value } });
  }
  expect(screen.getByTestId("itv-virtual-expert-preview-card")).toHaveTextContent("夜班护理角色");
  expect(screen.getByTestId("itv-virtual-expert-preview-card")).toHaveTextContent("擅长交接班；不代表真实受访者。");
  expect(screen.getByRole("button", { name: "保存并添加专家" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "已审阅画像及模拟边界" }));
  fireEvent.change(screen.getByRole("textbox", { name: "观点风格" }), { target: { value: "严谨" } });
  expect(screen.getByRole("button", { name: "保存并添加专家" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "已审阅画像及模拟边界" }));
  fireEvent.click(screen.getByRole("button", { name: "保存并添加专家" }));
  expect(change).toHaveBeenCalledWith(expect.stringContaining("擅长交接班；不代表真实受访者。"));
  expect(change.mock.calls[0]![0]).toContain("#expert-virtual-");
  expect(change.mock.calls[0]![0]).toContain("### 专业角色");
  expect(interviewMarkdown.parseInterviewMarkdown({ ...source, markdown: change.mock.calls[0]![0] }).blocks.filter((block) => block.links.some((link) => link.url.startsWith("#expert-virtual-")))).toHaveLength(1);
});
it("keeps AI virtual-expert proposals unsaved until human review and selection", async () => {
  const change = vi.fn();
  const suggest = vi.fn().mockResolvedValue("# 夜班护理角色\n\n## 专业角色\n护士长\n\n## 专业领域\n护理管理\n\n## 研究关注\n夜班交接班\n\n## 观点风格\n审慎务实\n\n## 简介\n基于已知材料模拟\n\n## 局限与材料边界\n不代表真实受访者");
  render(<InterviewExpertsStep document={source} directory={[]} pending={false} onChange={change} onSave={vi.fn()} onConfirm={vi.fn()} onGenerate={vi.fn()} onSuggestVirtual={suggest} />);
  fireEvent.click(screen.getByRole("button", { name: "添加虚拟专家" }));
  fireEvent.change(screen.getByRole("textbox", { name: "想添加怎样的专家" }), { target: { value: "需要一位关注夜班护理交接流程的专家，只基于已知资料给出模拟观点。" } });
  fireEvent.click(screen.getByRole("button", { name: "AI 生成专家画像" }));
  await vi.waitFor(() => expect(screen.getByRole("textbox", { name: "专家名称" })).toHaveValue("夜班护理角色"));
  expect(change).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "保存并添加专家" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "已审阅画像及模拟边界" }));
  fireEvent.click(screen.getByRole("button", { name: "保存并添加专家" }));
  expect(change).toHaveBeenCalledTimes(1);
});
it("sends any non-empty description through AI virtual-expert generation", async () => {
  const suggest = vi.fn().mockResolvedValue("# 客家研究者\n\n## 专业角色\n文化研究顾问\n\n## 专业领域\n客家文化\n\n## 研究关注\n迁徙与社区\n\n## 观点风格\n基于案例\n\n## 简介\n长期研究客家社群\n\n## 局限与材料边界\n仅用于模拟研究");
  render(<InterviewExpertsStep document={source} directory={[]} pending={false} onChange={vi.fn()} onConfirm={vi.fn()} onSuggestVirtual={suggest} />);
  fireEvent.click(screen.getByRole("button", { name: "添加虚拟专家" }));
  const generate = screen.getByRole("button", { name: "AI 生成专家画像" });
  expect(generate).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: "想添加怎样的专家" }), { target: { value: "客家专家" } });
  expect(generate).toBeEnabled();
  fireEvent.click(generate);
  await vi.waitFor(() => expect(suggest).toHaveBeenCalledWith("客家专家"));
  expect(await screen.findByDisplayValue("客家研究者")).toBeVisible();
});
it("restores confirmed experts in the outline rail before questions exist", () => {
  const expertsDocument = { ...source, markdown: "## [张浩宇](#expert-persona-68ecb1289191bb24396f9bd4)\n\n专业角色：AI 专家\n" };
  render(<InterviewOutlineStep document={{ ...source, step: "outline", markdown: "" }} expertsDocument={expertsDocument} pending={false} onChange={vi.fn()} onSave={vi.fn()} onConfirm={vi.fn()} onGenerate={vi.fn()} />);
  expect(screen.getByRole("button", { name: "张浩宇" })).toBeVisible();
  expect(screen.getByRole("img", { name: "张浩宇的插画头像" })).toBeVisible();
  expect(screen.getByText("尚无专家问题，请先生成访谈问题。")).toBeVisible();
});
it("shows generation progress with the confirmed expert count", () => {
  const expertsDocument = { ...source, markdown: "## [张浩宇](#expert-one)\n\n专业角色：AI 专家\n\n## [王志远](#expert-two)\n\n专业角色：架构师\n" };
  render(<InterviewOutlineStep document={{ ...source, step: "outline", markdown: "" }} expertsDocument={expertsDocument} pending generating onChange={vi.fn()} onSave={vi.fn()} onConfirm={vi.fn()} onGenerate={vi.fn()} />);
  expect(screen.getByRole("status")).toHaveTextContent("正在为 2 位专家生成问题");
  expect(screen.getByRole("button", { name: "正在为 2 位专家生成问题…" })).toBeDisabled();
});
it("question edit preserves stable heading references and unrelated raw Markdown", () => {
  const raw = "前言\r\n\r\n## [采购专家](#expert-purchase)\r\n\r\n1. 最近一次发生了什么？\r\n\r\n## [财务专家](#expert-finance)\r\n\r\n1. 谁批准预算？\r\n";
  const change = vi.fn();
  render(<InterviewOutlineStep document={{ ...source, step: "outline", markdown: raw }} pending={false} onChange={change} onSave={vi.fn()} onConfirm={vi.fn()} onGenerate={vi.fn()} />);
  const questions = screen.getByRole("list", { name: "采购专家访谈问题" });
  fireEvent.change(within(questions).getByRole("textbox", { name: "编辑问题 1" }), { target: { value: "最近一次夜班交接具体发生了什么？" } });
  const edited = change.mock.calls[0]![0] as string;
  expect(edited).toContain("## [采购专家](#expert-purchase)\r\n");
  expect(edited.endsWith("## [财务专家](#expert-finance)\r\n\r\n1. 谁批准预算？\r\n")).toBe(true);
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
it("shows expert identity cards and only direct questions in the outline workspace", () => {
  const expert = MOCK_DIGITAL_EXPERTS[0]!;
  const raw = `# 访谈问题\n\n## [${expert.displayName}](#expert-${expert.expertId})\n\n### 背景\n\n用于了解受访者的基本情况。\n\n- **你是谁？**\n  - **目的：**确认受访者身份。\n\n### 核心问题\n\n1. 你的爱好是什么？\n2. 你住在哪里？\n3. 用于了解受访者基本情况\n`;
  const expertsDocument = { ...source, step: "experts" as const, markdown: `## [${expert.displayName}](#expert-${expert.expertId})\n\n### 专业角色\n护士长\n` };
  render(<InterviewOutlineStep document={{ ...source, step: "outline", markdown: raw }} directory={[]} expertsDocument={expertsDocument} pending={false} onChange={vi.fn()} onSave={vi.fn()} onConfirm={vi.fn()} onGenerate={vi.fn()} />);

  const expertCard = within(screen.getByRole("navigation", { name: "访谈问题分组" })).getByRole("button", { name: expert.displayName });
  expect(within(expertCard).getByRole("img", { name: `${expert.displayName}的插画头像` })).toBeVisible();
  expect(within(expertCard).getByText(expert.displayName)).toBeVisible();
  expect(within(expertCard).getByText("护士长")).toBeVisible();
  expect(screen.queryByRole("button", { name: "背景" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "核心问题" })).not.toBeInTheDocument();

  const questions = screen.getByRole("list", { name: `${expert.displayName}访谈问题` });
  expect(within(questions).getAllByRole("textbox")).toHaveLength(3);
  expect(within(questions).getByDisplayValue("你是谁？")).toBeVisible();
  expect(within(questions).getByDisplayValue("你的爱好是什么？")).toBeVisible();
  expect(within(questions).getByDisplayValue("你住在哪里？")).toBeVisible();
  expect(screen.queryByText("用于了解受访者的基本情况。", { exact: false })).not.toBeInTheDocument();
  expect(screen.queryByText("确认受访者身份。", { exact: false })).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue("用于了解受访者基本情况")).not.toBeInTheDocument();
  expect(screen.queryByText("编辑本组 Markdown 原文")).not.toBeInTheDocument();
});
it("keeps a newly added or partially edited numbered question visible", () => {
  function EditableOutline() {
    const [markdown, setMarkdown] = React.useState("## [采购](#expert-purchase)\n\n1. 你是谁？\n");
    return <InterviewOutlineStep document={{ ...source, step: "outline", markdown }} pending={false} onChange={setMarkdown} onSave={vi.fn()} onConfirm={vi.fn()} onGenerate={vi.fn()} />;
  }
  render(<EditableOutline />);
  fireEvent.click(screen.getByRole("button", { name: "添加问题" }));
  expect(screen.getByRole("textbox", { name: "编辑问题 2" })).toHaveValue("新问题？");
  fireEvent.change(screen.getByRole("textbox", { name: "编辑问题 2" }), { target: { value: "正在输入" } });
  expect(screen.getByRole("textbox", { name: "编辑问题 2" })).toHaveValue("正在输入");
});
it("persists exactly the expert questions visible to the reviewer", () => {
  const raw = "# 访谈问题\n\n## [采购](#expert-purchase)\n\n### 背景\n\n用于了解采购流程。\n\n1. 谁提出采购？\n2. 目的：确认审批人\n\n## [财务](#expert-finance)\n\n- 谁批准预算？\n  - 说明：追问预算背景\n";
  expect(normalizeOutlineForPersistence({ ...source, step: "outline", markdown: raw })).toBe(
    "## [采购](#expert-purchase)\n\n1. 谁提出采购？\n\n## [财务](#expert-finance)\n\n1. 谁批准预算？\n",
  );
});
it("keeps expert selection focused on one confirm-and-generate action", () => {
  render(<InterviewExpertsStep document={source} directory={[]} pending={false} onChange={vi.fn()} onConfirm={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "生成专家建议" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "保存专家草稿" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "确认专家并生成问题" })).toBeDisabled();
});
it("regenerates an existing empty outline from confirmed experts before navigating", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4100"); vi.stubEnv("NEXT_PUBLIC_API_PATH_PREFIX", "");
  const expertDocument = { ...source, markdown: "## [张浩宇](#expert-persona-68ecb1289191bb24396f9bd4)\n\n专业角色：AI 专家\n" };
  const emptyOutline = { ...source, documentId: "outline-doc", step: "outline" as const, version: 3, markdown: "# 访谈问题\n" };
  const generatedOutline = { ...emptyOutline, version: 4, markdown: "## [张浩宇](#expert-persona-68ecb1289191bb24396f9bd4)\n\n1. 最近一次具体发生了什么？\n" };
  const generatedBodies: unknown[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url.endsWith("/digital/experts")) return new Response(JSON.stringify({ items: [] }));
    if (url.endsWith("/experts/confirm")) return new Response(JSON.stringify({ interviewId: "itv-edits", revisionId: "rev-edits", version: 5, documents: [expertDocument, emptyOutline], states: [{ documentId: expertDocument.documentId, status: "confirmed", failure: null }, { documentId: emptyOutline.documentId, status: "draft", failure: null }] }));
    if (url.endsWith("/outline/generate")) {
      generatedBodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ interviewId: "itv-edits", revisionId: "rev-edits", version: 6, documents: [expertDocument, generatedOutline], states: [{ documentId: expertDocument.documentId, status: "confirmed", failure: null }, { documentId: generatedOutline.documentId, status: "draft", failure: null }] }));
    }
    return new Response(JSON.stringify({ interviewId: "itv-edits", revisionId: "rev-edits", version: 4, documents: [expertDocument, emptyOutline], states: [{ documentId: expertDocument.documentId, status: "draft", failure: null }, { documentId: emptyOutline.documentId, status: "draft", failure: null }] }));
  });
  const onContinue = vi.fn();
  render(<InterviewMarkdownEditingStep interviewId="itv-edits" step="experts" onVersionChange={vi.fn()} onDirtyChange={vi.fn()} onContinue={onContinue} />);
  await vi.waitFor(() => expect(screen.getByRole("button", { name: "确认专家并生成问题" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "确认专家并生成问题" }));
  await vi.waitFor(() => expect(onContinue).toHaveBeenCalledWith("outline"));
  expect(generatedBodies).toEqual([{ expectedVersion: 5, expectedDocumentVersion: 3 }]);
});

const editableVirtualFields = { name: "林知远（虚拟）", role: "安装研究顾问", domains: "家居", focus: "安装异常", style: "审慎", bio: "合成角色，不代表真人。", limits: "仅用于模拟研究，无真人证据。" };
function fillVirtualExpert() {
  for (const [field, label] of [["name", "专家名称"], ["role", "专业角色"], ["domains", "专业领域"], ["focus", "研究关注"], ["style", "观点风格"], ["bio", "简介"], ["limits", "局限与材料边界"]] as const) {
    fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value: editableVirtualFields[field] } });
  }
  fireEvent.click(screen.getByRole("checkbox", { name: "已审阅画像及模拟边界" }));
}
it("awaits expert persistence before closing the dialog and keeps fields when saving fails", async () => {
  let rejectSave!: (error: Error) => void;
  const persist = vi.fn(() => new Promise<void>((_, reject) => { rejectSave = reject; }));
  render(<InterviewExpertsStep document={source} directory={[]} pending={false} onChange={vi.fn()} onConfirm={vi.fn()} onSaveExpert={persist} />);
  fireEvent.click(screen.getByRole("button", { name: "添加虚拟专家" })); fillVirtualExpert();
  fireEvent.click(screen.getByRole("button", { name: "保存并添加专家" }));
  expect(persist).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("dialog")).toBeVisible();
  rejectSave(new Error("network"));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("保存未完成"));
  expect(screen.getByRole("textbox", { name: "专家名称" })).toHaveValue(editableVirtualFields.name);
});
it("edits a saved virtual expert without replacing its stable ID and clears save-first avatar guidance", async () => {
  const { renderVirtualExpertSelection } = await import("@/lib/interview-virtual-expert");
  const markdown = `# 专家\n\n## [林知远（虚拟）](#expert-virtual-stable)\n\n${renderVirtualExpertSelection(editableVirtualFields)}\n`;
  const persist = vi.fn().mockResolvedValue(undefined);
  render(<InterviewExpertsStep document={{ ...source, markdown }} directory={[]} pending={false} onChange={vi.fn()} onConfirm={vi.fn()} onSaveExpert={persist} savedExpertIds={["virtual-stable"]} avatarContext={{ interviewId: "study", revisionId: "revision" }} />);
  const avatar = screen.getByRole("button", { name: "修改林知远（虚拟）头像" });
  expect(avatar).toBeEnabled(); expect(avatar).not.toHaveAttribute("title", "请先保存专家草稿，再修改虚拟专家头像。");
  fireEvent.click(screen.getByRole("button", { name: "编辑专家 林知远（虚拟）" }));
  expect(screen.getByRole("textbox", { name: "专业角色" })).toHaveValue(editableVirtualFields.role);
  fireEvent.change(screen.getByRole("textbox", { name: "专家名称" }), { target: { value: "陈书宁（虚拟）" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "已审阅画像及模拟边界" }));
  fireEvent.click(screen.getByRole("button", { name: "保存专家修改" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  const saved = persist.mock.calls[0]![0] as string;
  expect(saved).toContain("## [陈书宁（虚拟）](#expert-virtual-stable)");
  expect(saved.match(/#expert-virtual-stable/gu)).toHaveLength(1);
  expect(saved).not.toContain("林知远（虚拟）");
});
it("persisted add refreshes the source and enables avatar editing without confirming experts", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4100"); vi.stubEnv("NEXT_PUBLIC_API_PATH_PREFIX", "");
  let saved = { ...source }; let version = 1; const mutations: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url.endsWith("/digital/experts")) return new Response(JSON.stringify({ items: [] }));
    if (init.method === "POST" && url.endsWith("/markdown/experts")) { mutations.push(url); const body = JSON.parse(init.body as string); saved = { ...source, markdown: body.markdown, version: 2 }; version++; }
    return new Response(JSON.stringify({ interviewId: "itv-save-expert", revisionId: "rev-save-expert", version, documents: [saved], states: [{ documentId: saved.documentId, status: "draft", failure: null }] }));
  });
  const view = render(<InterviewMarkdownEditingStep interviewId="itv-save-expert" step="experts" onVersionChange={vi.fn()} onDirtyChange={vi.fn()} onContinue={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "添加虚拟专家" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "添加虚拟专家" })); fillVirtualExpert(); fireEvent.click(screen.getByRole("button", { name: "保存并添加专家" }));
  await waitFor(() => expect(mutations).toHaveLength(1));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "修改林知远（虚拟）头像" })).toBeEnabled();
  view.unmount();
  render(<InterviewMarkdownEditingStep interviewId="itv-save-expert" step="experts" onVersionChange={vi.fn()} onDirtyChange={vi.fn()} onContinue={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "编辑专家 林知远（虚拟）" })).toBeEnabled());
  expect(mutations[0]).toContain("/markdown/experts");
});

it("navigates to questions before their delayed model response finishes", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4100"); vi.stubEnv("NEXT_PUBLIC_API_PATH_PREFIX", "");
  const expert = { ...source, markdown: "## [护理专家](#expert-nurse)\n\n专业角色：护理" };
  const current = { interviewId: "itv-immediate", revisionId: "rev-immediate", version: 1, documents: [expert], states: [{ documentId: expert.documentId, status: "draft", failure: null }] };
  let finish!: (response: Response) => void;
  let requested = false;
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.endsWith("/digital/experts")) return new Response(JSON.stringify({ items: [] }));
    if (url.endsWith("/experts/confirm")) return new Response(JSON.stringify({ ...current, version: 2, states: [{ documentId: expert.documentId, status: "confirmed", failure: null }] }));
    if (url.endsWith("/outline/generate")) { requested = true; return new Promise<Response>(resolve => { finish = resolve; }); }
    return new Response(JSON.stringify(current));
  });
  const onContinue = vi.fn();
  render(<InterviewMarkdownEditingStep interviewId="itv-immediate" step="experts" onVersionChange={vi.fn()} onDirtyChange={vi.fn()} onContinue={onContinue} />);
  await vi.waitFor(() => expect(screen.getByRole("button", { name: "确认专家并生成问题" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "确认专家并生成问题" }));
  await vi.waitFor(() => expect(requested).toBe(true));
  expect(onContinue).toHaveBeenCalledWith("outline");
  finish(new Response(JSON.stringify({ ...current, version: 3 })));
});

it("does not replay a completed generation from an older revision", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4100"); vi.stubEnv("NEXT_PUBLIC_API_PATH_PREFIX", "");
  const oldOutline = { ...source, documentId: "outline-old", step: "outline" as const, markdown: "## [旧专家](#expert-old)\n\n1. 旧问题？" };
  await runInterviewGeneration("itv-new-revision", "outline", async () => ({ interviewId: "itv-new-revision", revisionId: "old-revision", version: 2, documents: [oldOutline], states: [{ documentId: oldOutline.documentId, status: "draft", failure: null }], execution: null, review: null }));
  const current = { interviewId: "itv-new-revision", revisionId: "new-revision", version: 7, documents: [{ ...oldOutline, markdown: "## [新专家](#expert-new)\n\n1. 新修订问题？" }], states: [{ documentId: oldOutline.documentId, status: "draft", failure: null }] };
  vi.stubGlobal("fetch", async (url: string) => new Response(JSON.stringify(url.endsWith("/digital/experts") ? { items: [] } : current)));
  render(<InterviewMarkdownEditingStep interviewId="itv-new-revision" step="outline" onVersionChange={vi.fn()} onDirtyChange={vi.fn()} onContinue={vi.fn()} />);
  expect(await screen.findByDisplayValue("新修订问题？")).toBeVisible();
  expect(screen.queryByDisplayValue("旧问题？")).not.toBeInTheDocument();
});

it("does not let a delayed initial read clear newly generated questions", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4100"); vi.stubEnv("NEXT_PUBLIC_API_PATH_PREFIX", "");
  const outline = { ...source, documentId: "outline-race", step: "outline" as const, markdown: "## [护理专家](#expert-nurse)\n\n1. 新生成问题？" };
  const generated = { interviewId: "itv-read-race", revisionId: "rev-race", version: 3, documents: [outline], states: [{ documentId: outline.documentId, status: "draft" as const, failure: null }], execution: null, review: null };
  let finishRead!: (response: Response) => void; let finishGeneration!: (value: typeof generated) => void;
  vi.stubGlobal("fetch", async (url: string) => url.endsWith("/digital/experts") ? new Response(JSON.stringify({ items: [] })) : new Promise<Response>(resolve => { finishRead = resolve; }));
  const request = runInterviewGeneration("itv-read-race", "outline", () => new Promise(resolve => { finishGeneration = resolve; }), { revisionId: "rev-race", version: 2 });
  render(<InterviewMarkdownEditingStep interviewId="itv-read-race" step="outline" onVersionChange={vi.fn()} onDirtyChange={vi.fn()} onContinue={vi.fn()} />);
  await vi.waitFor(() => expect(finishRead).toBeTypeOf("function"));
  finishGeneration(generated); await request;
  expect(await screen.findByDisplayValue("新生成问题？")).toBeVisible();
  finishRead(new Response(JSON.stringify({ ...generated, version: 2, documents: [{ ...outline, markdown: "" }] })));
  await vi.waitFor(() => expect(screen.getByRole("button", { name: "确认问题并开始访谈" })).toBeEnabled());
  expect(screen.getByDisplayValue("新生成问题？")).toBeVisible();
});
