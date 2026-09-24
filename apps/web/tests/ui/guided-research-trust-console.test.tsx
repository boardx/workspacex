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
    fireEvent.change(screen.getByLabelText("时间范围起点"), { target: { value: "2024-01-01" } });
    fireEvent.change(screen.getByLabelText("时间范围终点"), { target: { value: "2026-09-30" } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 0, intent: expect.objectContaining({ timeframe: { from: "2024-01-01", to: "2026-09-30" } }) }));
  });

  it("blocks a restrict policy with no allowed domains", () => {
    render(<GuidedResearchIntentPlan initialIntent={undefined} initialPolicy={undefined} revision={0} onConfirm={vi.fn()} disabled={false} />);
    fireEvent.change(screen.getByLabelText("决策对象"), { target: { value: "决定企业搜索供应商" } });
    fireEvent.change(screen.getByLabelText("成功标准"), { target: { value: "关键结论都有来源" } });
    fireEvent.click(screen.getByRole("radio", { name: "仅限指定站点" }));
    expect(screen.getByText("仅限指定站点时至少填写一个域名。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认研究边界" })).toBeDisabled();
  });

  it("blocks a reversed time range", () => {
    render(<GuidedResearchIntentPlan initialIntent={undefined} initialPolicy={undefined} revision={0} onConfirm={vi.fn()} disabled={false} />);
    fireEvent.change(screen.getByLabelText("决策对象"), { target: { value: "决定企业搜索供应商" } });
    fireEvent.change(screen.getByLabelText("成功标准"), { target: { value: "关键结论都有来源" } });
    fireEvent.change(screen.getByLabelText("时间范围起点"), { target: { value: "2026-09-30" } });
    fireEvent.change(screen.getByLabelText("时间范围终点"), { target: { value: "2024-01-01" } });
    expect(screen.getByText("时间范围必须是有效日期，且起点不能晚于终点。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认研究边界" })).toBeDisabled();
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
    }} pending={false} onSteer={vi.fn()} onResolveConflict={vi.fn()} />);
    for (const id of ["research-activity-trace", "research-steering-controls", "research-coverage-matrix", "research-claim-evidence", "research-conflict-view"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByText("证据不足")).toBeInTheDocument();
    expect(screen.getByText("原文")).toBeInTheDocument();
  });

  it("requires an explicit human conflict decision and sends the selected source", () => {
    const onResolveConflict = vi.fn();
    render(<GuidedResearchTrustConsole runtime={{
      planRevision: 1, controlStatus: "running", activity: [], coverage: [], claimEvidence: [],
      conflicts: [{ id: "x1", claimIds: ["c1", "c2"], sourceIds: ["src1", "src2"], severity: "severe", status: "open", resolution: null }],
    }} pending={false} onSteer={vi.fn()} onResolveConflict={onResolveConflict} />);
    expect(screen.getByRole("button", { name: "保留为不确定" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("冲突 x1 的裁决理由"), { target: { value: "两份资料口径不同，先保留不确定。" } });
    expect(screen.getByRole("button", { name: "采用 src1" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "采用 src1" }));
    expect(onResolveConflict).toHaveBeenCalledWith({ conflictId: "x1", action: "prefer_source", sourceId: "src1", rationale: "两份资料口径不同，先保留不确定。" });
  });

  it("renders replayed activity once in server sequence order", () => {
    const base = { planRevision: 1, controlStatus: "running" as const, coverage: [], claimEvidence: [], conflicts: [] };
    const { rerender } = render(<GuidedResearchTrustConsole runtime={{ ...base, activity: [
      { id: "e2", sequence: 2, stage: "reading", taskId: null, summary: "第二步", occurredAt: "2026-09-24T00:01:00Z", status: "succeeded" },
      { id: "e1", sequence: 1, stage: "searching", taskId: null, summary: "第一步", occurredAt: "2026-09-24T00:00:00Z", status: "succeeded" },
      { id: "e2", sequence: 2, stage: "reading", taskId: null, summary: "第二步", occurredAt: "2026-09-24T00:01:00Z", status: "succeeded" },
    ] }} pending={false} onSteer={vi.fn()} onResolveConflict={vi.fn()} />);
    expect(screen.getByTestId("research-activity-trace").textContent).toMatch(/第一步.*第二步/);
    expect(Array.from(screen.getByTestId("research-activity-trace").querySelectorAll("li")).filter((item) => item.textContent?.includes("第二步"))).toHaveLength(1);
    rerender(<GuidedResearchTrustConsole runtime={{ ...base, activity: [
      { id: "e3", sequence: 3, stage: "writing", taskId: null, summary: "第三步", occurredAt: "2026-09-24T00:02:00Z", status: "started" },
    ] }} pending={false} onSteer={vi.fn()} onResolveConflict={vi.fn()} />);
    expect(screen.getByTestId("research-activity-trace").textContent).toMatch(/第一步.*第二步.*第三步/);
  });
});
