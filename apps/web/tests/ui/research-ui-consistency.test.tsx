import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { ResearchFloatingAssistant } from "@/components/research-studio/research-floating-assistant";
import { describe, expect, it } from "vitest";
import { GuidedResearchReportWorkspace } from "@/components/research-studio/guided-research-report-workspace";

describe("research report navigation", () => {
  it("lets narrow-screen readers reveal the directory without putting it before the report by default", () => {
    render(<GuidedResearchReportWorkspace actions={null} contents={<a href="#chapter">第一章</a>} document={<h2 id="chapter">报告正文</h2>} metrics={null} limitation={null} />);
    const toggle = screen.getByRole("button", { name: "报告目录" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const directory = document.getElementById(toggle.getAttribute("aria-controls")!);
    expect(directory).toHaveClass("hidden");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(directory).not.toHaveClass("hidden");
    expect(screen.getByRole("link", { name: "第一章" })).toHaveAttribute("href", "#chapter");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("heading", { name: "报告正文" })).toBeInTheDocument();
  });
});

function Assistant() {
  const [open, setOpen] = useState(false);
  return <ResearchFloatingAssistant open={open} onOpenChange={setOpen}><input aria-label="向助手提问" /></ResearchFloatingAssistant>;
}
describe("research assistant keyboard recovery", () => {
  it("names the panel and returns focus to its launcher after Escape or explicit close", () => {
    render(<Assistant />);
    const launcher = screen.getByRole("button", { name: "AI 助手" });
    fireEvent.click(launcher);
    const panel = screen.getByRole("complementary", { name: "研究助手" });
    expect(launcher).toHaveAttribute("aria-controls", panel.id);
    const close = screen.getByRole("button", { name: "关闭研究助手" });
    expect(close).toHaveFocus();
    screen.getByRole("textbox").focus();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(launcher).toHaveFocus();
    fireEvent.click(launcher);
    fireEvent.click(screen.getByRole("button", { name: "关闭研究助手" }));
    expect(launcher).toHaveFocus();
  });
});
