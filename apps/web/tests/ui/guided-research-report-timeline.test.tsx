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
  it("restores real retries and warnings without empty report cards or replaying commands", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValue({ ...base, report: null, busy: true, leaseUntil: "2099-01-01T00:00:00Z", reportStream: { requestId: "r", sequence: 0, status: "streaming", text: "" }, reportTimeline: [{ id: "e", stage: "evidence", status: "warning", attempts: 2, completed: 2, total: 2 }, { id: "c", stage: "chapter", sectionId: "o1", status: "retrying", attempts: 2 }, { id: "v", stage: "validation", status: "pending", attempts: 0 }] });
    render(<GuidedResearchLive sessionId={base.sessionId} onBack={vi.fn()} />);
    const timeline = await screen.findByTestId("research-report-timeline");
    expect(timeline).toHaveTextContent("已处理，存在证据缺口");
    expect(timeline).toHaveTextContent("正在自动重试 · 第 2 次尝试");
    expect(timeline).toHaveTextContent("已调用模型 2 次");
    expect(timeline).toHaveTextContent("等待处理");
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
    expect(screen.getByText("报告已生成并保存。")).toBeInTheDocument();
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
