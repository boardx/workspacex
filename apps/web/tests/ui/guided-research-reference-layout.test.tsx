import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GuidedResearchEntryPanel } from "@/components/research-studio/guided-research-entry-panel";
import { GuidedResearchTopicPanel } from "@/components/research-studio/guided-research-topic-panel";
import { GuidedResearchPlanPanel } from "@/components/research-studio/guided-research-plan-panel";
import { GuidedResearchSourceWorkspace } from "@/components/research-studio/guided-research-source-workspace";
import { GuidedResearchReportWorkspace } from "@/components/research-studio/guided-research-report-workspace";
import { GuidedResearchSixStepShell } from "@/components/research-studio/guided-research-six-step-shell";
import { runtimeFixture } from "../guided-runtime-fixture";
import { ResearchTopicInformation } from "@/components/research-studio/research-topic-information";
import { ResearchChaptersWorkspace } from "@/components/research-studio/research-chapters-workspace";
import { ResearchLoading } from "@/components/research-studio/guided-research-presentation";

describe("guided research reference layout", () => {
  it("keeps topic essentials and offers a three-row freeform other field", () => {
    render(<ResearchTopicInformation brief={runtimeFixture().brief} disabled={false} onSave={vi.fn()} />);
    expect(screen.queryByRole("textbox", { name: "时间范围" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "研究区域" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "其它" })).toHaveAttribute("rows", "3");
    fireEvent.change(screen.getByRole("textbox", { name: "其它" }), { target: { value: "第一行\n" } });
    expect(screen.getByRole("textbox", { name: "其它" })).toHaveValue("第一行\n");
  });
  it("explains when preset focus choices make the combined focus exceed the contract limit", () => {
    render(<ResearchTopicInformation brief={runtimeFixture().brief} disabled={false} onSave={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "其它" }), { target: { value: "甲".repeat(2000) } });
    fireEvent.click(screen.getByRole("checkbox", { name: "市场增长质量" }));
    expect(screen.getByRole("alert")).toHaveTextContent("重点关注总长度不能超过 2000 字");
    expect(screen.queryByRole("button", { name: "保存研究信息" })).not.toBeInTheDocument();
  });
  it("keeps editing inline instead of asking for manual save confirmation", () => {
    const onSave = vi.fn();
    render(<ResearchTopicInformation brief={runtimeFixture().brief} disabled={false} onSave={onSave} />);
    fireEvent.change(screen.getByRole("textbox", { name: "研究主题" }), { target: { value: "更新后的研究主题" } });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("待保存");
  });
  it("lists report chapters with their subsections", () => {
    const state = runtimeFixture("report");
    state.outline[0]!.subsections = [{ id: "sub1", title: "准入政策", questions: ["有哪些要求？"] }];
    render(<ResearchChaptersWorkspace runtime={state} disabled={false} onSave={vi.fn()} onOptimize={vi.fn()} onNext={vi.fn()} />);
    expect(within(screen.getByTestId("research-chapters-workspace")).getByText("准入政策")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "小章节 1.1" })).toHaveValue("准入政策");
    expect(screen.queryByText("AI 生成的章节摘要")).not.toBeInTheDocument();
  });
  it("derives questions from edited new chapter and subchapter titles while preserving existing questions", () => {
    const state = runtimeFixture("report");
    const save = vi.fn();
    render(<ResearchChaptersWorkspace runtime={state} disabled={false} onSave={save} onOptimize={vi.fn()} onNext={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "新增章节" }));
    fireEvent.change(screen.getByRole("textbox", { name: "章节标题" }), { target: { value: "审批风险" } });
    fireEvent.click(screen.getByRole("button", { name: "新增小章节" }));
    fireEvent.change(screen.getByRole("textbox", { name: "小章节 2.1" }), { target: { value: "地方许可时长" } });
    fireEvent.click(screen.getByRole("button", { name: "保存章节结构" }));
    const saved = save.mock.calls[0]![0];
    expect(saved[0].questions).toEqual(state.outline[0]!.questions);
    expect(saved[1].questions[0]).toContain("审批风险");
    expect(saved[1].subsections[0].questions[0]).toContain("地方许可时长");
    expect(JSON.stringify(saved)).not.toContain("需要回答什么问题");
  });
  it("renders unavailable steps as circular indicators, not disabled button tiles", () => {
    const navigate = vi.fn();
    render(<GuidedResearchSixStepShell current="import" available={["import"]} onNavigate={navigate} main="需求" />);
    const indicator = screen.getByTestId("research-step-topic");
    expect(indicator).toHaveAttribute("aria-disabled", "true");
    expect(indicator.tagName).toBe("SPAN");
    expect(screen.queryByRole("button", { name: /2确认研究主题/ })).not.toBeInTheDocument();
    fireEvent.click(indicator);
    expect(navigate).not.toHaveBeenCalled();
  });
  it("requires explicit discard before header navigation leaves unsaved content", () => {
    const back = vi.fn();
    const navigate = vi.fn();
    render(<GuidedResearchSixStepShell current="topic" available={["import", "topic", "plan"]} onBack={back} onNavigate={navigate} hasUnsavedChanges main="草稿" />);
    fireEvent.click(screen.getByTestId("research-flow-back"));
    expect(back).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("尚未保存");
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(back).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /3研究计划/ }));
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "放弃修改并离开" }));
    expect(navigate).toHaveBeenCalledWith("plan");
  });
  it("places topic navigation inside the information card", () => {
    render(<GuidedResearchTopicPanel workspace="表单" actions={<button>下一步：研究计划</button>} />);
    expect(screen.getByTestId("research-topic-card")).toContainElement(screen.getByRole("button", { name: "下一步：研究计划" }));
  });
  it("shows only the expanded plan and actionable primary controls", () => {
    render(<GuidedResearchPlanPanel plan="计划 Markdown" onConfirm={vi.fn()} onBack={vi.fn()} disabled={false} />);
    expect(screen.getByTestId("guided-research-plan-panel")).toHaveAttribute("data-reference-layout", "plan-workspace");
    expect(screen.getByText("计划 Markdown")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "核心问题" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始研究" })).toHaveClass("bg-primary");
    expect(screen.getByRole("button", { name: "上一步" })).toHaveClass("bg-primary");
  });
  it("uses the reference-style six-step canvas instead of a generic document shell", () => {
    render(<GuidedResearchSixStepShell
      current="topic"
      researchName="欧洲储能市场进入策略"
      available={["import", "topic"]}
      onNavigate={vi.fn()}
      onBack={vi.fn()}
      main={<div>研究主题工作区</div>}
      assistant={<div>研究助手</div>}
    />);

    expect(screen.getByTestId("guided-research-six-step-shell")).toHaveAttribute("data-reference-layout", "prototype-desktop");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("欧洲储能市场进入策略");
    expect(screen.queryByText(/完善你的研究主题与相关信息/)).not.toBeInTheDocument();
    expect(screen.getByTestId("research-flow-progress")).toHaveAttribute("data-reference-variant", "monochrome-stepper");
    expect(screen.getByTestId("guided-research-six-step-main")).toHaveAttribute("data-reference-region", "work-canvas");
    expect(screen.getByTestId("guided-research-six-step-main")).toHaveClass("pb-24");
    fireEvent.click(screen.getByRole("button", { name: /AI 助手/ }));
    expect(screen.getByTestId("guided-research-six-step-assistant")).toHaveTextContent("研究助手");
  });

  it("keeps evidence metadata out of the minimal material list", () => {
    const state = runtimeFixture("research");
    state.sources = [
      { ...state.sources[0]!, id: "full", document: { url: state.sources[0]!.url, retrievedAt: "2026-09-29T00:00:00Z", text: "全文", contentHash: "a".repeat(64), contentKind: "html", truncated: false } },
      { ...state.sources[0]!, id: "snippet", title: "只有检索摘要", document: undefined },
    ];
    render(<GuidedResearchSourceWorkspace state={state} actions={null} />);
    expect(screen.queryByText("已读取全文")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("资料证据概况")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "已获取的研究资料" }).className).not.toContain("divide-y");
  });

  it("keeps only the usable import input and next-step action", () => {
    const onContinue = vi.fn();
    render(<GuidedResearchEntryPanel brief={<textarea aria-label="研究需求" />} onContinue={onContinue} disabled={false} />);

    expect(screen.getByTestId("guided-research-import-panel")).toBeInTheDocument();
    expect(screen.getByTestId("guided-research-import-panel")).toHaveAttribute("data-reference-layout", "intake-workspace");
    expect(screen.getByTestId("guided-research-import-panel").firstElementChild).toHaveClass("lg:min-h-[calc(100dvh-17rem)]");
    expect(screen.getByRole("textbox", { name: "研究需求" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "上传文件" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "录音" })).not.toBeInTheDocument();
    expect(screen.queryByText("草稿与重新生成")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认并继续" }));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it("hides import-only explanatory chrome while retaining the research steps", () => {
    render(<GuidedResearchSixStepShell current="import" available={["import"]} onNavigate={vi.fn()} main="需求" />);
    expect(screen.queryByText("智能研究平台")).not.toBeInTheDocument();
    expect(screen.queryByText(/通过文件、文本或实时语音输入需求/)).not.toBeInTheDocument();
    expect(screen.getByTestId("research-flow-progress")).toBeInTheDocument();
  });

  it("keeps topic editing beside the reference tips rather than a nested assistant", () => {
    render(<GuidedResearchTopicPanel workspace={<div>确认研究主题</div>} assistant={<div>主题助手建议</div>} />);

    expect(screen.getByTestId("guided-research-topic-panel")).toBeInTheDocument();
    expect(screen.getByTestId("guided-research-topic-panel")).toHaveAttribute("data-reference-layout", "topic-workspace");
    expect(screen.getByRole("heading", { name: "小提示" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "时间范围" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "研究区域" })).not.toBeInTheDocument();
    expect(screen.queryByText("主题助手建议")).not.toBeInTheDocument();
    expect(screen.getByText("确认研究主题")).toBeInTheDocument();
  });

  it("keeps only the research plan before confirmation", () => {
    render(<GuidedResearchPlanPanel plan={<div>计划 Markdown</div>} questions={<div>国家进入条件</div>} sourceScope={<div>政府与行业来源</div>} onConfirm={vi.fn()} disabled />);

    expect(screen.getByTestId("guided-research-plan-panel")).toBeInTheDocument();
    expect(screen.getByTestId("guided-research-plan-panel")).toHaveAttribute("data-reference-layout", "plan-workspace");
    expect(screen.getByText("计划 Markdown")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "核心问题" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始研究" })).toBeDisabled();
  });

  it("uses plan language while the plan is being generated", () => {
    render(<ResearchLoading node="outline" />);
    expect(screen.getByRole("status")).toHaveTextContent("正在生成研究计划");
    expect(screen.queryByText(/报告大纲|研究方向/)).not.toBeInTheDocument();
  });

  it("shows next-step chapters and only relevant search URLs without a middle activity column", () => {
    const state = runtimeFixture("research");
    state.outline.push({ ...state.outline[0]!, id: "o2", title: "未启用章节", enabled: false, order: 1 });
    state.sources.push(
      { ...state.sources[0]!, id: "manual", title: "手动来源", url: "https://example.org/manual", addedByUser: true },
      { ...state.sources[0]!, id: "excluded", title: "已排除来源", url: "https://example.org/excluded", decision: "excluded" },
      { ...state.sources[0]!, id: "internal", title: "内部资料", url: "https://internal.workspacex.local/artifacts/1" },
    );
    render(<GuidedResearchSourceWorkspace state={state} actions={<button>重试失败任务</button>} />);

    const workspace = screen.getByTestId("guided-research-source-workspace");
    expect(workspace).toHaveAttribute("data-reference-layout", "research-sources");
    expect(screen.queryByTestId("guided-research-source-chapters")).not.toBeInTheDocument();
    expect(screen.queryByText("未启用章节")).not.toBeInTheDocument();
    expect(screen.queryByText(/个任务|已完成|检索失败/)).not.toBeInTheDocument();
    expect(within(screen.getByTestId("guided-research-source-evidence")).getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("list", { name: "已获取的研究资料" })).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByRole("button", { name: "查看完整描述" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "实时动态" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "研究洞察" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "潜在冲突 / 风险提示" })).not.toBeInTheDocument();
    expect(screen.getByTestId("guided-research-source-actions")).toContainElement(screen.getByRole("button", { name: "重试失败任务" }));
  });
  it("does not render an empty research-material placeholder before a source arrives", () => {
    const state = runtimeFixture("research");
    state.sources = [];
    render(<GuidedResearchSourceWorkspace state={state} actions={null} />);
    expect(screen.queryByTestId("guided-research-source-evidence")).not.toBeInTheDocument();
    expect(screen.queryByText("尚未找到相关网址")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "已获取的研究资料", hidden: true })).toHaveAttribute("aria-live", "polite");
  });
  it("shows one description line with full text on hover and opens on double click", () => {
    const state = runtimeFixture("research");
    state.sources[0]!.presentation = { title: "政策说明", summary: "检索得到的政策说明全文" };
    render(<GuidedResearchSourceWorkspace state={state} actions={null} />);
    const source = screen.getByTestId("research-source-description-source1");
    expect(screen.queryByText("检索得到的政策说明全文")).not.toBeInTheDocument();
    expect(source).toHaveAttribute("title", "检索得到的政策说明全文");
    expect(screen.getByRole("link", { name: /政策说明/ })).toHaveAttribute("href", "https://example.org/policy");
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    fireEvent.click(source);
    expect(open).not.toHaveBeenCalled();
    fireEvent.doubleClick(source);
    expect(open).toHaveBeenCalledWith("https://example.org/policy", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });

  it("frames the report with contents, quality metrics, and an evidence limitation", () => {
    render(<GuidedResearchReportWorkspace actions={<button>下载 Word</button>} contents={<div>执行摘要</div>} document={<article>报告正文</article>} metrics={<div>28 个来源</div>} limitation={<div>证据覆盖存在缺口</div>} />);

    expect(screen.getByTestId("guided-research-report-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("guided-research-report-workspace")).toHaveAttribute("data-reference-layout", "report-document");
    expect(screen.getByTestId("guided-research-report-contents")).toHaveTextContent("执行摘要");
    expect(screen.getByTestId("guided-research-report-metrics")).toHaveTextContent("28 个来源");
    expect(screen.getByTestId("guided-research-report-limitation")).toHaveTextContent("证据覆盖存在缺口");
  });
});
