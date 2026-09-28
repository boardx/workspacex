import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GuidedResearchEntryPanel } from "@/components/research-studio/guided-research-entry-panel";
import { GuidedResearchTopicPanel } from "@/components/research-studio/guided-research-topic-panel";
import { GuidedResearchPlanPanel } from "@/components/research-studio/guided-research-plan-panel";
import { GuidedResearchSourceWorkspace } from "@/components/research-studio/guided-research-source-workspace";
import { GuidedResearchReportWorkspace } from "@/components/research-studio/guided-research-report-workspace";
import { GuidedResearchSixStepShell } from "@/components/research-studio/guided-research-six-step-shell";

describe("guided research reference layout", () => {
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
      available={["import", "topic"]}
      onNavigate={vi.fn()}
      onBack={vi.fn()}
      main={<div>研究主题工作区</div>}
      assistant={<div>研究助手</div>}
    />);

    expect(screen.getByTestId("guided-research-six-step-shell")).toHaveAttribute("data-reference-layout", "prototype-desktop");
    expect(screen.getByTestId("research-flow-progress")).toHaveAttribute("data-reference-variant", "monochrome-stepper");
    expect(screen.getByTestId("guided-research-six-step-main")).toHaveAttribute("data-reference-region", "work-canvas");
    fireEvent.click(screen.getByRole("button", { name: /AI 助手/ }));
    expect(screen.getByTestId("guided-research-six-step-assistant")).toHaveTextContent("研究助手");
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

  it("keeps live task activity, source evidence, and risk states in named research regions", () => {
    render(<GuidedResearchSourceWorkspace progress={<div>2 / 4</div>} activity={<div>正在检索政策资料</div>} evidence={<div>来源证据</div>} insights={<div>发现：市场增长</div>} risk={<div>1 项检索失败</div>} actions={<button>重试失败任务</button>} />);

    expect(screen.getByTestId("guided-research-source-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("guided-research-source-workspace")).toHaveAttribute("data-reference-layout", "research-operations");
    expect(screen.getByTestId("guided-research-source-progress")).toHaveTextContent("2 / 4");
    expect(screen.getByTestId("guided-research-source-activity")).toHaveTextContent("正在检索政策资料");
    expect(screen.getByTestId("guided-research-source-evidence")).toHaveTextContent("来源证据");
    expect(screen.getByTestId("guided-research-source-risks")).toHaveTextContent("1 项检索失败");
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
