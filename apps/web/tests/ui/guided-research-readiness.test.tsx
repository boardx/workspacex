import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GuidedResearchReadiness } from "../../components/research-studio/guided-research-readiness";
import { researchCompletionLabel, researchLimitations } from "../../components/research-studio/guided-research-readiness";

describe("guided research publication readiness", () => {
  it("renders limited completion and explains blockers", () => {
    render(<GuidedResearchReadiness quality={{ citationCoverage: 50, authority: null, recency: 100, crossValidation: 0, openGapCount: 1, overall: 50, explanations: ["按问题计算"] }} readiness={{ status: "limited", blockers: ["关键结论缺少来源"], warnings: [], evaluatedAt: "2026-09-24T00:00:00Z" }} />);
    expect(screen.getByTestId("research-publication-readiness")).toHaveTextContent("带限制完成");
    expect(screen.getByText("关键结论缺少来源")).toBeInTheDocument();
    expect(screen.getByTestId("research-quality-score")).toHaveTextContent("暂无数据");
  });

  it("renders a server-ready result without a limitation banner", () => {
    render(<GuidedResearchReadiness quality={{ citationCoverage: 100, authority: 100, recency: 100, crossValidation: 100, openGapCount: 0, overall: 100, explanations: [] }} readiness={{ status: "ready", blockers: [], warnings: [] }} />);
    expect(screen.getByTestId("research-publication-readiness")).toHaveTextContent("可发布");
    expect(screen.queryByText("带限制完成")).not.toBeInTheDocument();
  });

  it("never treats completed legacy state without readiness as unconditionally complete", () => {
    expect(researchCompletionLabel(true, undefined)).toBe("质量待评估");
    expect(researchLimitations(true, undefined)).toContain("尚未经过发布质量门");
  });
});
