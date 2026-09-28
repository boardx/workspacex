import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { GuidedResearchLive } from "@/components/research-studio/guided-research-live";
import { GuidedResearchReportPreview } from "@/components/research-studio/guided-research-report-preview";
import { ResearchChaptersWorkspace } from "@/components/research-studio/research-chapters-workspace";
import { researchReportDocument } from "@/lib/research-report-document";
import { executeResearchRuntime, getResearchRuntime } from "@/lib/guided-research-api";
import { runtimeFixture } from "../guided-runtime-fixture";
vi.mock("@/lib/guided-research-api", () => ({ getResearchRuntime: vi.fn(), executeResearchRuntime: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.useRealTimers());
describe("reference research workflow", () => {
  it("protects unsaved topic information from the shared return button", async () => {
    const initial = runtimeFixture("directions");
    const back = vi.fn();
    vi.mocked(getResearchRuntime).mockResolvedValue(initial);
    render(<GuidedResearchLive sessionId={initial.sessionId} onBack={back} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "研究主题" }), { target: { value: "未保存主题" } });
    fireEvent.click(screen.getByTestId("research-flow-back"));
    expect(back).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByRole("textbox", { name: "研究主题" })).toHaveValue("未保存主题");
  });
  it("protects local report chapter edits from the shared header", async () => {
    const initial = runtimeFixture("report");
    const back = vi.fn();
    vi.mocked(getResearchRuntime).mockResolvedValue(initial);
    render(<GuidedResearchLive sessionId={initial.sessionId} visualStage="chapters" onBack={back} />);
    fireEvent.click(await screen.findByText("编辑章节内容"));
    fireEvent.change(screen.getByLabelText("章节标题"), { target: { value: "未保存章节" } });
    fireEvent.click(screen.getByTestId("research-flow-back"));
    expect(back).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByLabelText("章节标题")).toHaveValue("未保存章节");
  });
  it("shows the research plan preview by default without the old scope cards", async () => {
    const initial = runtimeFixture("outline");
    vi.mocked(getResearchRuntime).mockResolvedValue(initial);
    render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
    await screen.findByTestId("guided-research-plan-panel");
    expect(screen.getByTestId("guided-research-markdown-preview")).toBeVisible();
    expect(screen.queryByTestId("guided-research-markdown-editor")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("guided-research-plan-panel")).getAllByRole("heading", { name: "研究计划" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "编辑成功标准" })).not.toBeInTheDocument();
    expect(executeResearchRuntime).not.toHaveBeenCalled();
  });
  it("blocks topic confirmation until edited research information is saved", async () => {
    const initial = runtimeFixture("directions");
    vi.mocked(getResearchRuntime).mockResolvedValue(initial);
    render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "研究主题" }), { target: { value: "新的研究主题" } });
    expect(screen.getByRole("button", { name: "下一步：研究计划" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存研究信息" })).toBeEnabled();
    expect(executeResearchRuntime).not.toHaveBeenCalled();
  });
  it("preserves unsaved chapter edits across unchanged server polls and saves the actual outline", () => {
    const initial = runtimeFixture("report");
    const save = vi.fn();
    const props = { runtime: initial, disabled: false, onSave: save, onOptimize: vi.fn(), onNext: vi.fn() };
    const view = render(<ResearchChaptersWorkspace {...props} />);
    fireEvent.click(screen.getByText("编辑章节内容"));
    fireEvent.change(screen.getByLabelText("章节标题"), { target: { value: "政策约束与实施路径" } });
    view.rerender(<ResearchChaptersWorkspace {...props} runtime={{ ...initial, outline: initial.outline.map((chapter) => ({ ...chapter })) }} />);
    expect(screen.getByLabelText("章节标题")).toHaveValue("政策约束与实施路径");
    expect(screen.getByRole("button", { name: "下一步：生成报告" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "保存章节结构" }));
    expect(save).toHaveBeenCalledWith([{ ...initial.outline[0], title: "政策约束与实施路径" }]);
  });
  it("adds a real outline chapter and reorders it without losing stable chapter identities", () => {
    const initial = runtimeFixture("report");
    const save = vi.fn();
    render(<ResearchChaptersWorkspace runtime={initial} disabled={false} onSave={save} onOptimize={vi.fn()} onNext={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "新增章节" }));
    fireEvent.click(screen.getByRole("button", { name: "章节上移" }));
    fireEvent.click(screen.getByRole("button", { name: "保存章节结构" }));
    const chapters = save.mock.calls[0]![0];
    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toMatchObject({ title: "新章节", order: 0, enabled: true });
    expect(chapters[1]).toMatchObject({ id: initial.outline[0]!.id, order: 1 });
    expect(new Set(chapters.map((chapter: { id: string }) => chapter.id)).size).toBe(2);
  });
  it("offers direct report view and export actions in the report workspace", async () => {
    const initial = runtimeFixture("report");
    vi.mocked(getResearchRuntime).mockResolvedValue(initial);
    render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "在线查看" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "下载 Word" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "导出 PDF" })).toBeEnabled();
    expect(screen.getByTestId("research-report-cover")).toHaveTextContent("政策研究报告");
    expect(screen.getAllByRole("navigation", { name: /报告.*目录/ })).toHaveLength(1);
  });
  it("edits topic scope in the topic screen without losing the submitted brief", async () => {
    const initial = runtimeFixture("directions");
    vi.mocked(getResearchRuntime).mockResolvedValue(initial);
    vi.mocked(executeResearchRuntime).mockResolvedValue({ ...initial, version: initial.version + 1, brief: { ...initial.brief, topic: "Revised European scope" } });
    render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
    const topic = await screen.findByRole("textbox", { name: "研究主题" });
    fireEvent.change(topic, { target: { value: "Revised European scope" } });
    fireEvent.click(screen.getByRole("button", { name: "保存研究信息" }));
    await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({ node: "brief", action: "save", draft: { node: "brief", value: { ...initial.brief, topic: "Revised European scope" } } })));
    expect(await screen.findByDisplayValue("Revised European scope")).toBeInTheDocument();
  });
  it("selects one chapter at a time instead of rendering every chapter detail", async () => {
    const initial = runtimeFixture("report");
    initial.outline = [...initial.outline, { ...initial.outline[0]!, id: "chapter-two", title: "第二章政策", objective: "核查政策约束", order: 1 }];
    vi.mocked(getResearchRuntime).mockResolvedValue(initial);
    render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} visualStage="chapters" />);
    fireEvent.click(await screen.findByRole("button", { name: "2. 第二章政策" }));
    expect(screen.getByTestId("research-selected-chapter")).toHaveTextContent("核查政策约束");
    expect(screen.getByRole("button", { name: "下一步：生成报告" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "上一步" })).toBeEnabled();
  });
  it("shows only searched source descriptions while research is busy", async () => {
    const initial = runtimeFixture("research");
    vi.mocked(getResearchRuntime).mockResolvedValue({ ...initial, busy: true, leaseUntil: "2099-01-01T00:00:00.000Z", progress: { stage: "searching", completed: 2, total: 5 }, researchPlan: { overview: "先对比政策，再核查进入门槛", optimizedQuestion: "哪些市场值得优先进入？" }, tasks: [{ ...initial.tasks[0]!, status: "succeeded", title: "政策与准入核查", objective: "核实补贴和并网要求", deliverables: ["政策对比表", "准入风险清单"] }, ...Array.from({ length: 4 }, (_, index) => ({ ...initial.tasks[0]!, id: `extra-${index}`, status: index === 0 ? "succeeded" as const : "pending" as const }))] });
    render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
    expect(await screen.findByRole("list", { name: "搜索得到的相关网址" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "报告章节" })).not.toBeInTheDocument();
    expect(screen.getByTestId("research-source-description-source1")).toHaveAttribute("href", "https://example.org/policy");
    expect(screen.queryByTestId("research-runtime-progress")).not.toBeInTheDocument();
    expect(screen.queryByText("查看搜索详情")).not.toBeInTheDocument();
    expect(executeResearchRuntime).not.toHaveBeenCalled();
  });
  it("does not let a poll issued before a progress snapshot roll its stage back", async () => {
    const initial = runtimeFixture("research");
    let finishPoll!: (state: typeof initial) => void;
    let emit!: NonNullable<Parameters<typeof executeResearchRuntime>[1]>;
    vi.mocked(getResearchRuntime).mockResolvedValueOnce(initial).mockImplementationOnce(() => new Promise((resolve) => { finishPoll = resolve; }));
    vi.mocked(executeResearchRuntime).mockImplementation((_input, callback) => { emit = callback!; return new Promise(() => undefined); });
    vi.useFakeTimers();
    await act(async () => { render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />); });
    fireEvent.click(screen.getByRole("button", { name: "确认并继续" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    const snapshot = { ...initial, version: 5, busy: true, leaseUntil: "2099-01-01T00:00:00.000Z", currentNode: "report" as const, progress: { stage: "writing" as const, completed: 1, total: 2 } };
    await act(async () => { emit({ type: "snapshot", state: snapshot }); });
    await act(async () => { finishPoll({ ...snapshot, progress: { stage: "organizing", completed: 0, total: 2 } }); });
    expect(screen.getByTestId("research-runtime-progress")).toHaveTextContent("撰写报告章节 · 1 / 2");
  });
  it("resolves refreshed preview aliases only to accepted sources and groups unknown citations as pending", () => {
    const initial = runtimeFixture("report");
    const state = { ...initial, report: null, reportSourceAliases: [{ alias: "S1", sourceId: "source1" }, { alias: "S2", sourceId: "excluded" }], sources: [...initial.sources, { ...initial.sources[0]!, id: "excluded", decision: "excluded" as const }], reportStream: { requestId: "r", sequence: 3, status: "streaming" as const, text: '{"summary":"真实结论[[source:S1]]。待证实[[source:S2]][[source:missing]]' } };
    render(<GuidedResearchReportPreview state={state} />);
    expect(screen.getByTestId("research-inline-citation")).toHaveAttribute("href", initial.sources[0]!.url);
    expect(screen.getByTestId("research-preview-citations-pending")).toHaveTextContent("2 处内容引用待核对");
    expect(screen.queryByText(/来源不可用/)).not.toBeInTheDocument();
    expect(within(screen.getByTestId("research-report-references")).getAllByRole("listitem")).toHaveLength(1);
  });
  it("keeps invalid final citations visible and does not accept draft aliases for a final report", () => {
    const initial = runtimeFixture("report");
    const doc = researchReportDocument({ title: "Report", summary: "[[source:S1]][[source:missing", sections: [] }, initial.sources, initial.outline, { aliases: [{ alias: "S1", sourceId: "source1" }] });
    expect(doc.references).toHaveLength(0); expect(doc.summary).toBe("〔来源不可用〕〔来源不可用〕");
  });
  it("keeps checkpoint chapters on refresh and retries remaining chapters through one streaming command", async () => {
    const initial = runtimeFixture("report");
    const state = { ...initial, report: null, errorCode: "RESEARCH_WORKFLOW_UNAVAILABLE", progress: { stage: "writing" as const, completed: 1, total: 2, sectionId: "o1" }, reportCheckpoint: { basis: "basis", chapters: [{ sectionId: "o1", body: "已经保存的章节[[source:source1]]", sourceIds: ["source1"] }] } };
    vi.mocked(getResearchRuntime).mockResolvedValue(state); vi.mocked(executeResearchRuntime).mockImplementation(() => new Promise(() => undefined));
    render(<GuidedResearchLive sessionId={state.sessionId} onBack={vi.fn()} />);
    expect(await screen.findByText("已经保存的章节")).toBeInTheDocument();
    expect(screen.getByTestId("research-runtime-progress")).toHaveTextContent("已暂停");
    fireEvent.click(screen.getByRole("button", { name: "生成完整报告" }));
    await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalledTimes(1));
    expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({ action: "retry", node: "report", expectedVersion: state.version }), expect.any(Function), expect.any(AbortSignal));
  });
  it("resumes checkpoint chapters after a server lease expires without an error code", async () => {
    const initial = runtimeFixture("report");
    const state = { ...initial, report: null, busy: true, leaseUntil: "2000-01-01T00:00:00.000Z", errorCode: null, reportCheckpoint: { basis: "basis", chapters: [{ sectionId: "o1", body: "重启前保存的章节", sourceIds: ["source1"] }] } };
    vi.mocked(getResearchRuntime).mockResolvedValue(state); vi.mocked(executeResearchRuntime).mockImplementation(() => new Promise(() => undefined));
    render(<GuidedResearchLive sessionId={state.sessionId} onBack={vi.fn()} />);
    const resume = await screen.findByRole("button", { name: "生成完整报告" });
    expect(resume).toBeEnabled();
    expect(screen.getByText("重启前保存的章节")).toBeInTheDocument();
    fireEvent.click(resume);
    expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({ action: "retry", node: "report", expectedVersion: state.version }), expect.any(Function), expect.any(AbortSignal));
    expect(screen.getByText("重启前保存的章节")).toBeInTheDocument();
  });
  it("still exposes full regeneration separately from checkpoint resume", async () => {
    const initial = runtimeFixture("report");
    const state = { ...initial, report: null, errorCode: "RESEARCH_WORKFLOW_UNAVAILABLE", reportCheckpoint: { basis: "basis", chapters: initial.report!.sections } };
    vi.mocked(getResearchRuntime).mockResolvedValue(state); vi.mocked(executeResearchRuntime).mockImplementation(() => new Promise(() => undefined));
    render(<GuidedResearchLive sessionId={state.sessionId} onBack={vi.fn()} />);
    const preview = await screen.findByTestId("research-report-preview");
    fireEvent.pointerDown(within(preview).getByRole("button", { name: "更多操作" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "重新生成报告" }));
    expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({ action: "generate", node: "report" }), expect.any(Function), expect.any(AbortSignal));
  });
  it("keeps a regeneration action when a failed stream has no renderable report content", async () => {
    const initial = runtimeFixture("report");
    const state = { ...initial, report: null, reportDraft: null, errorCode: "RESEARCH_WORKFLOW_UNAVAILABLE", reportStream: { requestId: "r", sequence: 4, status: "failed" as const, text: '{"sections":[' } };
    vi.mocked(getResearchRuntime).mockResolvedValue(state);
    vi.mocked(executeResearchRuntime).mockImplementation(() => new Promise(() => undefined));
    render(<GuidedResearchLive sessionId={state.sessionId} onBack={vi.fn()} />);

    expect(await screen.findByRole("button", { name: "生成完整报告" })).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole("button", { name: "更多操作" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "重新生成报告" }));
    expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({ action: "generate", node: "report" }), expect.any(Function), expect.any(AbortSignal));
  });
  it("groups completed report actions under one menu beside the primary completion action", async () => {
    const initial = runtimeFixture("report");
    vi.mocked(getResearchRuntime).mockResolvedValue(initial);
    vi.mocked(executeResearchRuntime).mockImplementation(() => new Promise(() => undefined));
    render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
    await screen.findByTestId("research-report");

    const report = screen.getByTestId("research-report");
    const toolbar = within(report).getByTestId("research-report-actions");
    expect(within(toolbar).getByRole("button", { name: "完成研究" })).toBeInTheDocument();
    const more = within(toolbar).getByRole("button", { name: "更多操作" });
    expect(screen.getByRole("button", { name: "下载 Word" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "导出 PDF" })).toBeEnabled();
    fireEvent.pointerDown(more, { button: 0, ctrlKey: false });
    expect(await screen.findByRole("menuitem", { name: "重新生成报告" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "重新生成报告" }));
    expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({ action: "generate", node: "report" }), expect.any(Function), expect.any(AbortSignal));
  });
});
