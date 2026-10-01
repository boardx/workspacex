import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GuidedResearchReportTimeline } from "@/components/research-studio/guided-research-report-timeline";
import { GuidedResearchLive } from "@/components/research-studio/guided-research-live";
import { executeResearchRuntime, getResearchRuntime } from "@/lib/guided-research-api";
import { runtimeFixture } from "../guided-runtime-fixture";
vi.mock("@/lib/guided-research-api", () => ({ getResearchRuntime: vi.fn(), executeResearchRuntime: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
const base = runtimeFixture("report");
describe("continuous generation timeline", () => {
  it("combines chapter writing and review into one generation row with icon status", () => {
    render(<GuidedResearchReportTimeline state={{ ...base, busy: true, reportTimeline: [
      { id: "c", stage: "chapter", sectionId: "o1", status: "completed", attempts: 1 },
      { id: "r", stage: "review", sectionId: "o1", status: "running", attempts: 1 },
    ] }} />);
    expect(screen.getAllByTestId("research-report-timeline-step")).toHaveLength(1);
    expect(screen.getByText("生成 · 政策章节")).toBeInTheDocument();
    expect(screen.queryByText(/撰写|核验章节|正在处理|已完成/)).not.toBeInTheDocument();
    expect(screen.getByTestId("research-report-timeline-step")).toHaveAttribute("data-status", "running");
  });
  it.each(["running", "retrying", "completed"] as const)("keeps the generation spinner while writing is %s and review is pending", (status) => {
    render(<GuidedResearchReportTimeline state={{ ...base, busy: true, reportTimeline: [
      { id: "c", stage: "chapter", sectionId: "o1", status, attempts: 1 },
      { id: "r", stage: "review", sectionId: "o1", status: "pending", attempts: 0 },
    ] }} />);
    expect(screen.getByTestId("research-report-timeline-step")).toHaveAttribute("aria-busy", "true");
  });
  it.each([ ["pending", "等待生成"], ["completed", "生成完成"], ["running", "生成中"], ["retrying", "重试生成中"] ] as const)("exposes %s status to screen readers without visible status rows", (status, label) => {
    render(<GuidedResearchReportTimeline state={{ ...base, busy: true, reportTimeline: [
      { id: "c", stage: "chapter", sectionId: "o1", status, attempts: 1 },
    ] }} />);
    expect(screen.getByText(`${label}，`)).toHaveClass("sr-only");
  });
  it("restores real retries and warnings without empty report cards or replaying commands", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValue({ ...base, report: null, busy: true, leaseUntil: "2099-01-01T00:00:00Z", reportStream: { requestId: "r", sequence: 0, status: "streaming", text: "" }, reportTimeline: [{ id: "e", stage: "evidence", status: "warning", attempts: 2, completed: 2, total: 2 }, { id: "c", stage: "chapter", sectionId: "o1", status: "retrying", attempts: 2 }, { id: "v", stage: "validation", status: "pending", attempts: 0 }] });
    render(<GuidedResearchLive sessionId={base.sessionId} onBack={vi.fn()} />);
    const timeline = await screen.findByTestId("research-report-timeline");
    expect(timeline).toHaveTextContent("存在证据缺口");
    expect(timeline).toHaveTextContent("第 2 次尝试");
    expect(timeline.querySelectorAll("[aria-busy=true]")).toHaveLength(1);
    expect(timeline).not.toHaveTextContent("等待处理");
    expect(screen.queryByTestId("research-report-preview")).not.toBeInTheDocument();
    expect(screen.queryByTestId("research-runtime-progress")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(executeResearchRuntime).not.toHaveBeenCalled();
  });
  it("announces completion only after final validation and distinguishes interrupted execution", () => {
    const pending = [{ id: "v", stage: "validation" as const, status: "pending" as const, attempts: 0 }];
    const { rerender } = render(<GuidedResearchReportTimeline state={{ ...base, busy: true, reportTimeline: pending }} />);
    expect(screen.queryByText("报告已生成并保存。")).not.toBeInTheDocument();
    rerender(<GuidedResearchReportTimeline state={{ ...base, busy: false, reportTimeline: pending }} interrupted />);
    expect(screen.getByText("执行已中断，已保存的进度仍可继续。")).toBeInTheDocument();
    rerender(<GuidedResearchReportTimeline state={{ ...base, busy: false, reportTimeline: [{ ...pending[0]!, status: "completed" }] }} />);
    expect(screen.getByTestId("research-report-timeline-step")).toHaveAttribute("data-status", "completed");
    expect(screen.queryByText("报告已生成并保存。")).not.toBeInTheDocument();
  });
  it("resumes an expired failed attempt once and preserves its checkpoint", async () => {
    const checkpoint = { basis: "basis", chapters: base.report!.sections };
    const state = { ...base, report: null, busy: true, leaseUntil: "2000-01-01T00:00:00Z", reportCheckpoint: checkpoint, reportTimeline: [{ id: "c", stage: "chapter" as const, status: "running" as const, attempts: 1 }] };
    vi.mocked(getResearchRuntime).mockResolvedValue(state);
    vi.mocked(executeResearchRuntime).mockResolvedValue({ ...state, busy: false, report: base.report });
    render(<GuidedResearchLive sessionId={base.sessionId} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "生成完整报告" }));
    await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalledTimes(1));
    expect(vi.mocked(executeResearchRuntime).mock.calls[0]![0]).toMatchObject({ action: "retry", node: "report" });
    expect(await screen.findByTestId("research-report")).toBeInTheDocument();
  });
});
