import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GuidedResearchIntentPlan } from "../../components/research-studio/guided-research-intent-plan";
import { GuidedResearchTrustConsole, mergeActivityEvents } from "../../components/research-studio/guided-research-trust-console";

describe("guided research trust console", () => {
  it("blocks confirmation until decision and success criteria are present", () => {
    const onConfirm = vi.fn();
    render(<GuidedResearchIntentPlan initialIntent={undefined} initialPolicy={undefined} revision={0} onConfirm={onConfirm} disabled={false} />);
    const submit = screen.getByRole("button", { name: "确认研究边界" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("决策对象"), { target: { value: "决定企业搜索供应商" } });
    fireEvent.change(screen.getByLabelText("成功标准"), { target: { value: "关键结论都有来源" } });
    fireEvent.change(screen.getByLabelText("时间范围起点"), { target: { value: "2024-01" } });
    fireEvent.change(screen.getByLabelText("时间范围终点"), { target: { value: "2026-09" } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 0, intent: expect.objectContaining({ timeframe: { from: "2024-01", to: "2026-09" } }) }));
  });

  it("deduplicates replayed activity in server order", () => {
    const event = (id: string, sequence: number) => ({ id, sequence, stage: "searching" as const, taskId: null, summary: id, occurredAt: "2026-09-24T00:00:00Z", status: "succeeded" as const });
    expect(mergeActivityEvents([event("e2", 2)], [event("e1", 1), event("e2", 2)]).map((item) => item.id)).toEqual(["e1", "e2"]);
  });

  it("renders coverage, activity, evidence, conflicts and steering controls", () => {
    render(<GuidedResearchTrustConsole runtime={{
      planRevision: 1, controlStatus: "running",
      activity: [{ id: "a1", sequence: 1, stage: "searching", taskId: null, summary: "正在检索", occurredAt: "2026-09-24T00:00:00Z", status: "started" }],
      coverage: [{ sectionId: "s1", questionId: "q1", status: "weak", evidenceIds: ["src1"], reasons: ["证据不足"] }],
      claimEvidence: [{ claimId: "c1", evidenceId: "e1", quote: "原文", sourceId: "src1", retrievedAt: "2026-09-24T00:00:00Z", confidence: "medium", traceIds: ["t1"] }],
      conflicts: [{ id: "x1", claimIds: ["c1", "c2"], sourceIds: ["src1", "src2"], severity: "severe", status: "open", resolution: null }],
    }} pending={false} onSteer={vi.fn()} />);
    for (const id of ["research-activity-trace", "research-steering-controls", "research-coverage-matrix", "research-claim-evidence", "research-conflict-view"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByText("证据不足")).toBeInTheDocument();
    expect(screen.getByText("原文")).toBeInTheDocument();
  });

  it("renders replayed activity once in server sequence order", () => {
    const base = { planRevision: 1, controlStatus: "running" as const, coverage: [], claimEvidence: [], conflicts: [] };
    const { rerender } = render(<GuidedResearchTrustConsole runtime={{ ...base, activity: [
      { id: "e2", sequence: 2, stage: "reading", taskId: null, summary: "第二步", occurredAt: "2026-09-24T00:01:00Z", status: "succeeded" },
      { id: "e1", sequence: 1, stage: "searching", taskId: null, summary: "第一步", occurredAt: "2026-09-24T00:00:00Z", status: "succeeded" },
      { id: "e2", sequence: 2, stage: "reading", taskId: null, summary: "第二步", occurredAt: "2026-09-24T00:01:00Z", status: "succeeded" },
    ] }} pending={false} onSteer={vi.fn()} />);
    expect(screen.getByTestId("research-activity-trace").textContent).toMatch(/第一步.*第二步/);
    expect(Array.from(screen.getByTestId("research-activity-trace").querySelectorAll("li")).filter((item) => item.textContent?.includes("第二步"))).toHaveLength(1);
    rerender(<GuidedResearchTrustConsole runtime={{ ...base, activity: [
      { id: "e3", sequence: 3, stage: "writing", taskId: null, summary: "第三步", occurredAt: "2026-09-24T00:02:00Z", status: "started" },
    ] }} pending={false} onSteer={vi.fn()} />);
    expect(screen.getByTestId("research-activity-trace").textContent).toMatch(/第一步.*第二步.*第三步/);
  });
});
