import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InterviewIntakeStep } from "@/components/itv/interview-intake-step";
import { InterviewAnalysisStep } from "@/components/itv/interview-analysis-step";
import { InterviewMarkdownPlanningStep } from "@/components/itv/interview-markdown-planning-step";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const raw = "# 研究需求\r\n\r\n教师最近一次备课 🧪\r\n";
it("native file input saves imported Markdown through the sole source API", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4100"); vi.stubEnv("NEXT_PUBLIC_API_PATH_PREFIX", "");
  const document = { documentId: "intake-file", step: "intake", version: 1, contentHash: "a".repeat(64), evidenceMode: "simulated", references: [], markdown: raw };
  const writes: { markdown: string }[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    if (init.method === "POST") writes.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ interviewId: "itv-file", revisionId: "rev-file", version: 1, documents: [document], states: [{ documentId: document.documentId, status: "draft", failure: null }] }));
  });
  render(<InterviewMarkdownPlanningStep interviewId="itv-file" step="intake" onVersionChange={vi.fn()} onDirtyChange={vi.fn()} onContinue={vi.fn()} />);
  const input = screen.getByRole("textbox", { name: "研究需求 Markdown" });
  await waitFor(() => expect(input).toBeEnabled());
  const imported = "## 原始材料\r\n\r\n保留 **原文**。";
  const file = { name: "材料.md", size: 100, arrayBuffer: async () => new TextEncoder().encode(imported).buffer };
  fireEvent.change(screen.getByLabelText("导入研究文件"), { target: { files: [file] } });
  await waitFor(() => expect(input).toHaveValue((raw + "\n\n" + imported).replaceAll("\r\n", "\n")));
  fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]?.markdown).toBe(raw + "\n\n" + imported);
});
function Intake({ onImportFile, onVoice }: { onImportFile?: (file: File) => Promise<string>; onVoice?: () => Promise<string> }) {
  const [markdown, setMarkdown] = React.useState(raw);
  return <InterviewIntakeStep markdown={markdown} onChange={setMarkdown} onSave={async () => undefined} onConfirm={async () => undefined} onImportFile={onImportFile} onVoice={onVoice} pending={false} />;
}
it("importsTextAsMarkdown keeps Markdown editable without a structured research copy", () => {
  render(<Intake />);
  const input = screen.getByRole("textbox", { name: "研究需求 Markdown" });
  // Browser textarea display normalizes CRLF; API byte preservation is tested separately.
  expect(input).toHaveValue(raw.replaceAll("\r\n", "\n"));
  fireEvent.change(input, { target: { value: "## 目标\n- 寻找反例" } });
  expect(input).toHaveValue("## 目标\n- 寻找反例");
});

it("loads the persisted partial analysis after a failed generation before retrying", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4100");
  vi.stubEnv("NEXT_PUBLIC_API_PATH_PREFIX", "");
  let failed = false;
  const doc = { documentId: "partial-analysis", step: "analysis", version: 1, contentHash: "a".repeat(64), evidenceMode: "simulated", references: [], markdown: "## 研究范围\n夜班交接的部分分析。" };
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    if (init.method === "POST") { failed = true; return new Response(JSON.stringify({ reasonCode: "AI_GENERATION_UNAVAILABLE" }), { status: 503 }); }
    return new Response(JSON.stringify({ interviewId: "itv-partial", revisionId: "rev-partial", version: failed ? 2 : 1,
      documents: failed ? [doc] : [], states: failed ? [{ documentId: doc.documentId, status: "failed", failure: { code: "AI_GENERATION_UNAVAILABLE", retryable: true } }] : [] }));
  });
  render(<InterviewMarkdownPlanningStep interviewId="itv-partial" step="analysis" onVersionChange={vi.fn()} onDirtyChange={vi.fn()} onContinue={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "生成研究分析" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "生成研究分析" }));
  expect(await screen.findByText("夜班交接的部分分析。")).toBeVisible();
});
it("fileFailureKeepsDraft and reports a recovery action", async () => {
  render(<Intake onImportFile={async () => { throw new Error("文件提取失败"); }} />);
  fireEvent.change(screen.getByLabelText("导入研究文件"), { target: { files: [new File(["body"], "需求.txt", { type: "text/plain" })] } });
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("文件提取失败"));
  expect(screen.getByRole("textbox")).toHaveValue(raw.replaceAll("\r\n", "\n"));
});
it("microphoneDeniedCanUseText without losing the existing demand", async () => {
  render(<Intake onVoice={async () => { throw new Error("麦克风权限被拒绝"); }} />);
  fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("麦克风权限被拒绝"));
  expect(screen.getByRole("textbox")).toBeEnabled();
});
it("analysisCardsReflectGeneratedDocument rather than fixed generic findings", () => {
  const markdown = "# AI 分析\n\n## 研究目标\n访谈护理人员最近一次交接班。\n\n## 研究范围\n夜班，不包含采购决策。\n\n## 建议\n先寻找失败案例。";
  render(<InterviewAnalysisStep document={{ documentId: "md-ui", step: "analysis", version: 2, contentHash: "a".repeat(64), evidenceMode: "simulated", references: [], markdown }} pending={false} onGenerate={vi.fn()} onConfirm={vi.fn()} />);
  expect(screen.getByText("访谈护理人员最近一次交接班。")).toBeVisible();
  expect(screen.getByText("夜班，不包含采购决策。")).toBeVisible();
  expect(screen.getByText("先寻找失败案例。")).toBeVisible();
  expect(screen.queryByText("最终决策者")).not.toBeInTheDocument();
});

it("confirmation persists Markdown first and generates analysis without a JSON research-body copy", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4100");
  vi.stubEnv("NEXT_PUBLIC_API_PATH_PREFIX", "");
  const input = { documentId: "md-intake", step: "intake", version: 1, contentHash: "a".repeat(64), evidenceMode: "simulated", references: [], markdown: raw };
  const generated = { ...input, documentId: "md-analysis", step: "analysis", markdown: "## 研究目标\n只研究夜班交接。" };
  const calls: { path: string; body: unknown }[] = [];
  const onContinue = vi.fn();
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body });
    const confirmed = path.endsWith("/confirm");
    const generation = path.endsWith("/generate");
    const documents = generation ? [{ ...input, version: 2 }, generated] : [{ ...input, version: confirmed ? 2 : 1 }];
    return new Response(JSON.stringify({ interviewId: "itv-plan", revisionId: "rev-plan", version: generation ? 3 : confirmed ? 2 : 1, documents,
      states: documents.map((doc) => ({ documentId: doc.documentId, status: generation && doc.step === "analysis" ? "draft" : confirmed || generation ? "confirmed" : "draft", failure: null })) }));
  });
  render(<InterviewMarkdownPlanningStep interviewId="itv-plan" step="intake" onVersionChange={vi.fn()} onDirtyChange={vi.fn()} onContinue={onContinue} />);
  await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(raw.replaceAll("\r\n", "\n")));
  fireEvent.click(screen.getByRole("button", { name: "下一步：确认分析" }));
  await waitFor(() => expect(onContinue).toHaveBeenCalledWith("analysis"));
  expect(calls.filter((call) => call.body !== undefined)).toEqual([
    { path: "/interviews/digital/itv-plan/markdown/intake/confirm", body: { expectedVersion: 1, expectedDocumentVersion: 1 } },
    { path: "/interviews/digital/itv-plan/markdown/analysis/generate", body: { expectedVersion: 2, expectedDocumentVersion: 0 } },
  ]);
});
