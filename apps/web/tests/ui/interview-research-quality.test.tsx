import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DigitalInterviewQualityPanel } from "@/components/itv/digital-interview-quality-panel";
import { DigitalInterviewReadiness } from "@/components/itv/digital-interview-readiness";

const warningQuality = {
  previewStatus: "available" as const, briefIssues: [], expertCoverage: [], questionFindings: [], evidenceCoverage: [], readinessDecision: null,
  readiness: { status: "warning" as const, ruleVersion: "quality-v1", evaluatedAt: "2026-09-24T00:00:00.000Z",
    issues: [{ code: "EXPERT_GOAL_SINGLE_PERSPECTIVE", severity: "warning" as const, message: "只有一种专家视角", objectId: "goal-1" }],
    estimatedMinutes: { min: 12, max: 18 } },
};

describe("digital interview research quality", () => {
  it("does not turn an unavailable preview into a false zero-issue state", () => {
    render(<DigitalInterviewQualityPanel quality={null} unavailable onRetry={vi.fn()} />);
    expect(screen.getByTestId("itv-quality-unknown")).toHaveTextContent("质量检查暂不可用，当前状态未知");
    expect(screen.queryByText("0 个问题")).not.toBeInTheDocument();
  });

  it("requires a documented rationale before accepting warnings", () => {
    const decide = vi.fn();
    render(<DigitalInterviewReadiness quality={warningQuality} onDecide={decide} />);
    const start = screen.getByTestId("itv-start-ready");
    expect(start).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "已确认单一视角风险，并安排真人访谈补证。" } });
    expect(start).toBeEnabled();
    fireEvent.click(start);
    expect(decide).toHaveBeenCalledWith("warning_accepted", "已确认单一视角风险，并安排真人访谈补证。");
  });
});
