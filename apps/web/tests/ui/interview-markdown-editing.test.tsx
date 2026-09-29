import * as React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InterviewExpertsStep } from "@/components/itv/interview-experts-step";
import { InterviewOutlineStep, normalizeOutlineForPersistence } from "@/components/itv/interview-outline-step";
import { InterviewMarkdownEditingStep } from "@/components/itv/interview-markdown-editing-step";
import { EXPERT_SPECIALTY_ICON_CATEGORIES } from "@/components/itv/expert-specialty-icon";
import { INTERVIEW_PERSONA_CATEGORIES, INTERVIEW_PERSONAS } from "@/lib/interview-personas/persona-library";
import { MOCK_DIGITAL_EXPERTS, toDigitalExpertCatalogRow } from "@/lib/mock/digital-expert-personas";
import { interviewMarkdown } from "@repo/contracts";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const source = { documentId: "edit-doc", step: "experts" as const, version: 1, contentHash: "a".repeat(64), evidenceMode: "simulated" as const, references: [], markdown: "# 专家\n" };
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
  render(<InterviewMarkdownEditingStep interviewId="itv-edits" step="experts" onVersionChange={vi.fn()} onDirtyChange={vi.fn()} onContinue={vi.fn()} />);
  expect(await screen.findByRole("status")).toHaveTextContent("只读");
  expect(screen.getByRole("button", { name: "添加画像 张浩宇" })).toBeDisabled();
  expect(screen.queryByRole("textbox", { name: "专家文档 Markdown" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "生成专家建议" })).toBeDisabled();
  expect(posts).toEqual([]);
});
it("failed generation reconciles persisted partial text into a clean editor", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4100"); vi.stubEnv("NEXT_PUBLIC_API_PATH_PREFIX", "");
  const failedMarkdown = "## [夜班护理角色](#expert-night-shift)\n\n已保存的部分画像。\n\n材料边界仍待核对。";
  let failed = false;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (init.method === "POST") { failed = true; return new Response(JSON.stringify({ message: "unavailable" }), { status: 503 }); }
    return new Response(JSON.stringify(url.endsWith("/digital/experts") ? { items: [] } : { interviewId: "itv-edits", revisionId: "rev-edits", version: failed ? 2 : 1, documents: [{ ...source, markdown: failed ? failedMarkdown : source.markdown }], states: [{ documentId: source.documentId, status: failed ? "failed" : "draft", failure: null }] }));
  });
  render(<InterviewMarkdownEditingStep interviewId="itv-edits" step="experts" onVersionChange={vi.fn()} onDirtyChange={vi.fn()} onContinue={vi.fn()} />);
  await vi.waitFor(() => expect(screen.getByRole("button", { name: "生成专家建议" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "生成专家建议" }));
  await screen.findByRole("alert");
  expect(screen.getByTestId("itv-expert-draft-context").querySelector("pre")?.textContent).toBe(failedMarkdown);
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
  await vi.waitFor(() => expect(screen.getByRole("button", { name: "添加画像 张浩宇" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "添加画像 张浩宇" }));
  fireEvent.click(screen.getByRole("button", { name: "保存专家草稿" }));
  await screen.findByRole("alert");
  await vi.waitFor(() => expect(screen.getByRole("button", { name: "保存专家草稿" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "保存专家草稿" }));
  await vi.waitFor(() => expect(writes).toHaveLength(2));
  expect(writes.map((write) => [write.expectedVersion, write.expectedDocumentVersion])).toEqual([[1, 1], [1, 1]]);
});
it("expert search filters the maintained simulation library without impersonating the live directory", () => {
  render(<InterviewExpertsStep document={source} directory={[]} pending={false} onChange={vi.fn()} onSave={vi.fn()} onConfirm={vi.fn()} onGenerate={vi.fn()} />);
  expect(screen.getByText("97 位模拟画像")).toBeVisible();
  expect(within(screen.getByTestId("itv-persona-card-persona-68ecb1289191bb24396f9bd4")).getByRole("img", { name: "技术专家专业图标" })).toBeVisible();
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

  const expertCard = screen.getByRole("button", { name: new RegExp(expert.displayName) });
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
it("generation cannot silently discard an unsaved expert Markdown edit", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4100"); vi.stubEnv("NEXT_PUBLIC_API_PATH_PREFIX", "");
  const posts: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (init.method === "POST") posts.push(url);
    return new Response(JSON.stringify(url.endsWith("/digital/experts") ? { items: [] } : { interviewId: "itv-edits", revisionId: "rev-edits", version: 1, documents: [source], states: [{ documentId: source.documentId, status: "draft", failure: null }] }));
  });
  render(<InterviewMarkdownEditingStep interviewId="itv-edits" step="experts" onVersionChange={vi.fn()} onDirtyChange={vi.fn()} onContinue={vi.fn()} />);
  await vi.waitFor(() => expect(screen.getByRole("button", { name: "添加画像 张浩宇" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "添加画像 张浩宇" }));
  fireEvent.click(screen.getByRole("button", { name: "生成专家建议" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("先保存");
  expect(screen.getByRole("button", { name: "移除专家 张浩宇" })).toBeVisible();
  expect(posts).toEqual([]);
});
