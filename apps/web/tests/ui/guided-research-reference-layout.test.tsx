import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GuidedResearchEntryPanel } from "@/components/research-studio/guided-research-entry-panel";
import { GuidedResearchTopicPanel } from "@/components/research-studio/guided-research-topic-panel";
import { GuidedResearchPlanPanel } from "@/components/research-studio/guided-research-plan-panel";
import { GuidedResearchSourceWorkspace } from "@/components/research-studio/guided-research-source-workspace";
import { GuidedResearchReportWorkspace } from "@/components/research-studio/guided-research-report-workspace";
import { GuidedResearchSixStepShell } from "@/components/research-studio/guided-research-six-step-shell";

describe("guided research reference layout", () => {
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
    expect(screen.getByTestId("research-flow-progress")).toHaveAttribute("data-reference-variant", "blue-stepper");
    expect(screen.getByTestId("guided-research-six-step-main").parentElement).toHaveAttribute("data-reference-region", "work-canvas");
    expect(screen.getByTestId("guided-research-six-step-assistant")).toHaveAttribute("data-reference-region", "assistant-rail");
  });

  it("offers truthful import routes around the brief workspace", () => {
    render(<GuidedResearchEntryPanel brief={<div>研究需求 Markdown</div>} onContinue={vi.fn()} onRegenerate={vi.fn()} onSave={vi.fn()} disabled={false} />);

    expect(screen.getByTestId("guided-research-import-panel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择文件" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "开始录音" })).toBeDisabled();
    expect(screen.getByText("当前环境尚未配置文件导入")).toBeInTheDocument();
    expect(screen.getByText("当前环境尚未配置实时录音")).toBeInTheDocument();
    expect(screen.getByText("研究需求 Markdown")).toBeInTheDocument();
  });

  it("keeps topic editing beside an explicit assistant region", () => {
    render(<GuidedResearchTopicPanel workspace={<div>确认研究主题</div>} assistant={<div>主题助手建议</div>} />);

    expect(screen.getByTestId("guided-research-topic-panel")).toBeInTheDocument();
    expect(screen.getByTestId("guided-research-topic-assistant")).toHaveTextContent("主题助手建议");
    expect(screen.getByText("确认研究主题")).toBeInTheDocument();
  });

  it("groups plan, key questions, and source scope before confirmation", () => {
    render(<GuidedResearchPlanPanel plan={<div>计划 Markdown</div>} questions={<div>国家进入条件</div>} sourceScope={<div>政府与行业来源</div>} onConfirm={vi.fn()} disabled />);

    expect(screen.getByTestId("guided-research-plan-panel")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "研究计划" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "核心问题" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "资料范围" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始研究" })).toBeDisabled();
  });

  it("keeps live task activity, source evidence, and risk states in named research regions", () => {
    render(<GuidedResearchSourceWorkspace progress={<div>2 / 4</div>} activity={<div>正在检索政策资料</div>} evidence={<div>来源证据</div>} insights={<div>发现：市场增长</div>} risk={<div>1 项检索失败</div>} actions={<button>重试失败任务</button>} />);

    expect(screen.getByTestId("guided-research-source-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("guided-research-source-progress")).toHaveTextContent("2 / 4");
    expect(screen.getByTestId("guided-research-source-activity")).toHaveTextContent("正在检索政策资料");
    expect(screen.getByTestId("guided-research-source-evidence")).toHaveTextContent("来源证据");
    expect(screen.getByTestId("guided-research-source-risks")).toHaveTextContent("1 项检索失败");
  });

  it("frames the report with contents, quality metrics, and an evidence limitation", () => {
    render(<GuidedResearchReportWorkspace actions={<button>下载 Word</button>} contents={<div>执行摘要</div>} document={<article>报告正文</article>} metrics={<div>28 个来源</div>} limitation={<div>证据覆盖存在缺口</div>} />);

    expect(screen.getByTestId("guided-research-report-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("guided-research-report-contents")).toHaveTextContent("执行摘要");
    expect(screen.getByTestId("guided-research-report-metrics")).toHaveTextContent("28 个来源");
    expect(screen.getByTestId("guided-research-report-limitation")).toHaveTextContent("证据覆盖存在缺口");
  });
});
