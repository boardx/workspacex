import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GuidedResearchLive } from "@/components/research-studio/guided-research-live";
import { ResearchDesignPreview, ResearchOutlineEditor } from "@/components/research-studio/guided-research-design-editor";
import { executeResearchRuntime, getResearchRuntime, type GuidedResearchRuntimeDraft as Draft } from "@/lib/guided-research-api";
import { runtimeFixture } from "../guided-runtime-fixture";
import { research } from "@repo/contracts";
vi.mock("@/lib/guided-research-api", () => ({ getResearchRuntime: vi.fn(), executeResearchRuntime: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
const detail = { decisionQuestions: ["进入哪个市场？"], hypotheses: ["政策支持增长"], comparisonDimensions: ["经济性"], evidenceNeeds: ["一手政策文件"] };
describe("editable research design depth", () => {
  it("preserves direction design when editing the title and regenerating with a changed question", async () => {
    const state = runtimeFixture("directions"); state.directions[0] = { ...state.directions[0]!, ...detail };
    vi.mocked(getResearchRuntime).mockResolvedValue(state); vi.mocked(executeResearchRuntime).mockResolvedValue({ ...state, version: 5 });
    render(<GuidedResearchLive sessionId={state.sessionId} onBack={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("研究方向"), { target: { value: "市场优先级" } });
    fireEvent.click(screen.getByText(/研究设计 · 问题/));
    fireEvent.change(screen.getByLabelText("决策问题"), { target: { value: "先验证哪些市场？\n如何选择进入模式？" } });
    fireEvent.click(screen.getByRole("button", { name: "重新生成本步骤" }));
    await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalled());
    expect(vi.mocked(executeResearchRuntime).mock.calls[0]?.[0].draft).toEqual({ node: "directions", value: [{ ...state.directions[0], title: "市场优先级", decisionQuestions: ["先验证哪些市场？", "如何选择进入模式？"] }] });
  });
  it("edits chapter methods, subsection titles and questions without dropping sibling design fields", async () => {
    const state = runtimeFixture("outline"); state.outline[0] = { ...state.outline[0]!, objective: "验证市场机会", analysisApproach: "交叉核验", expectedOutput: "进入建议", subsections: [{ id: "sub1", title: "市场规模", questions: ["规模是多少？"] }] };
    vi.mocked(getResearchRuntime).mockResolvedValue(state); vi.mocked(executeResearchRuntime).mockResolvedValue({ ...state, version: 5 });
    render(<GuidedResearchLive sessionId={state.sessionId} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByText(/研究设计与小节/));
    fireEvent.change(screen.getByLabelText("分析方法"), { target: { value: "跨国对比与反证分析" } });
    fireEvent.change(screen.getByLabelText("小节标题"), { target: { value: "市场规模与增速" } });
    fireEvent.change(screen.getByLabelText("小节研究问题"), { target: { value: "规模是多少？\n口径是否一致？" } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalled());
    expect(vi.mocked(executeResearchRuntime).mock.calls[0]?.[0].draft).toEqual({ node: "outline", value: [{ ...state.outline[0], analysisApproach: "跨国对比与反证分析", subsections: [{ id: "sub1", title: "市场规模与增速", questions: ["规模是多少？", "口径是否一致？"] }] }] });
  });
  it("supports legacy outlines and adding/removing subsections with contract-valid defaults", () => {
    const state = runtimeFixture("outline"); let latest: Draft = { node: "outline", value: state.outline };
    function Editor() { const [draft, setDraft] = React.useState<Extract<Draft, { node: "outline" }>>({ node: "outline", value: state.outline }); return <ResearchOutlineEditor draft={draft} disabled={false} onChange={(next) => { latest = next; setDraft(next); }} />; }
    render(<Editor />);
    fireEvent.click(screen.getByText(/研究设计与小节/));
    expect(screen.getByLabelText("章节目标")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "添加小节" }));
    expect(research.GuidedResearchRuntimeDraft.safeParse(latest).success).toBe(true);
    expect(screen.getByLabelText("小节标题")).toHaveValue("新小节");
    fireEvent.click(screen.getByRole("button", { name: "删除小节" }));
    expect(research.GuidedResearchRuntimeDraft.safeParse(latest).success).toBe(true);
    fireEvent.change(screen.getByLabelText("章节目标"), { target: { value: "新目标" } });
    fireEvent.change(screen.getByLabelText("章节目标"), { target: { value: "" } });
    expect(research.GuidedResearchRuntimeDraft.safeParse(latest).success).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "添加章节" }));
    expect(research.GuidedResearchRuntimeDraft.safeParse(latest).success).toBe(true);
  });
  it.each([
    ["RESEARCH_EVIDENCE_BUDGET_EXCEEDED", "请精简后重试"],
    ["RESEARCH_REPORT_QUALITY_INSUFFICIENT", "请完善大纲或补充来源后重试"],
  ] as const)("explains %s with an actionable recovery instruction", async (errorCode, message) => {
    vi.mocked(getResearchRuntime).mockResolvedValue({ ...runtimeFixture("report"), report: null, errorCode });
    render(<GuidedResearchLive sessionId="grs-live" onBack={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });
  it("exposes all deep design fields in Skill and recovery previews", () => {
    const state = runtimeFixture("directions"); const { rerender } = render(<ResearchDesignPreview draft={{ node: "directions", value: [{ ...state.directions[0]!, ...detail }] }} />);
    for (const text of Object.values(detail).flat()) expect(screen.getByText(text)).toBeInTheDocument();
    rerender(<ResearchDesignPreview draft={{ node: "outline", value: [{ ...state.outline[0]!, objective: "章节目标值", analysisApproach: "方法值", expectedOutput: "产出值", subsections: [{ id: "sub1", title: "小节标题值", questions: ["小节问题值"] }] }] }} />);
    for (const text of ["章节目标值", "方法值", "产出值", "小节标题值", "小节问题值"]) expect(screen.getByText(text, { exact: false })).toBeInTheDocument();
  });
});
