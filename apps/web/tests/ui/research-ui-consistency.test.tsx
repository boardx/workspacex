import { fireEvent, render, screen } from "@testing-library/react";
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
