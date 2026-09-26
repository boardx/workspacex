import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GuidedResearchEntryPanel } from "@/components/research-studio/guided-research-entry-panel";
import { GuidedResearchTopicPanel } from "@/components/research-studio/guided-research-topic-panel";

describe("guided research reference layout", () => {
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
});
