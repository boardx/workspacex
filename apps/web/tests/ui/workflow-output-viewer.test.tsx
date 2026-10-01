/**
 * UC-WC-3 —— 运行产出页：加载 / 失败 / 空 / PRD 渲染 + 阶段来源提示；数据经契约 schema `.parse`。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { workContent, workflowRuntime } from "@repo/contracts";
import { ApiError } from "@/lib/api-client";

const api = vi.hoisted(() => ({ getWorkflowInstance: vi.fn(), getWorkflowInstanceOutput: vi.fn() }));
vi.mock("@/lib/workflow-runtime-api", async (orig) => ({ ...(await orig<object>()), ...api }));
vi.mock("@/components/shell/app-shell", () => ({
  AppShell: (p: { left?: unknown; children: unknown }) => <div data-testid="app-shell">{p.left as never}{p.children as never}</div>,
}));

import WorkflowRunOutputPage from "@/app/workflows/runs/[instanceId]/result/page";

const DIGEST = "a".repeat(64);
const prdOutput = (output: unknown) =>
  workContent.operations.getInstanceOutput.out.parse({
    instanceId: "i1", outcome: "complete", output, crmItems: [], manualChecklist: [], deferredProposals: [],
  });
const PRD = {
  kind: "prd", title: "离线同步 PRD",
  problem: { claimId: "c1", text: "外勤人员断网时无法记录", evidenceRefs: ["doc:interview-3"], confidence: "high" },
  requirements: [{ id: "R1", text: "断网可写入草稿", priority: "P0" }],
  metrics: [{ name: "同步成功率", definition: "24h 内成功同步的草稿占比" }],
  digest: DIGEST,
};
const projection = () =>
  workflowRuntime.WorkflowInstanceProjection.parse({
    instanceId: "i1", orgId: "o1", workflowKey: "prd-writer", definitionVersion: 2,
    agentId: "a1", agentVersionId: "av1", initiatorUserId: "u1", triggerKind: "manual",
    status: "succeeded", stateVersion: 9, reasonCode: null,
    stages: [{ stageId: "problem_frame", title: "问题框定", status: "succeeded", attempt: 1,
      pinnedSkills: [{ stageId: "problem_frame", stableId: "S064", version: "1.0.0" }],
      outputs: [{ outputId: "out-1", label: "问题陈述", href: "/workflows/runs/i1/result?output=out-1" }],
      reasonCode: null, startedAt: null, finishedAt: null }],
    openGate: null, effects: [], lastSeq: 10,
    viewerCapabilities: { canCancel: false, canRetryStage: false, canResume: false }, createdAt: "2026-09-30T00:00:00Z", updatedAt: "2026-09-30T00:00:00Z",
  });

beforeEach(() => {
  vi.clearAllMocks();
  api.getWorkflowInstance.mockResolvedValue(projection());
});

describe("WorkflowOutputViewer", () => {
  it("PRD：标题、问题陈述+证据、需求、指标、版本与阶段来源", async () => {
    let resolve!: (v: unknown) => void;
    api.getWorkflowInstanceOutput.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<WorkflowRunOutputPage params={{ instanceId: "i1" }} searchParams={{ output: "out-1" }} />);
    expect(screen.getByTestId("workflow-output-viewer").getAttribute("data-state")).toBe("loading");
    resolve(prdOutput(PRD));
    await waitFor(() => expect(screen.getByTestId("workflow-output-viewer").getAttribute("data-state")).toBe("ready"));
    expect(screen.getByTestId("workflow-output-title").textContent).toBe("离线同步 PRD");
    expect(screen.getByTestId("workflow-output-problem").textContent).toContain("来源 1 · 文档");
    expect(screen.getByTestId("workflow-output-requirements").textContent).toContain("断网可写入草稿");
    expect(screen.getByTestId("workflow-output-metrics").textContent).toContain("同步成功率");
    expect(screen.getByTestId("workflow-output-tech-details").hasAttribute("open")).toBe(false);
    expect(screen.getByTestId("workflow-output-tech-details").textContent).toContain("S064@1.0.0");
    expect(screen.getByTestId("workflow-output-source").textContent).toContain("问题陈述");
    expect(screen.getByTestId("workflow-output-back").getAttribute("href")).toBe("/workflows/runs/i1");
    expect(api.getWorkflowInstanceOutput).toHaveBeenCalledWith("i1");
  });

  it("调试痕迹不上屏：[loopback] 标题人话化、证据成来源标签、哈希与技能编号只在折叠的技术详情里", async () => {
    api.getWorkflowInstanceOutput.mockResolvedValue(prdOutput({
      ...PRD, title: "[loopback] PRD (revise)",
      problem: { ...PRD.problem, text: "[loopback] 外勤断网", evidenceRefs: ["loopback:frame"] },
    }));
    render(<WorkflowRunOutputPage params={{ instanceId: "i1" }} />);
    await waitFor(() => expect(screen.getByTestId("workflow-output-prd")).toBeTruthy());
    expect(screen.getByTestId("workflow-output-title").textContent).toBe("PRD（修订版）");
    expect(screen.getByTestId("workflow-output-evidence-chip").textContent).toBe("来源 1 · 演示数据");
    const tech = screen.getByTestId("workflow-output-tech-details");
    expect(tech.hasAttribute("open")).toBe(false);
    expect(tech.textContent).toContain(DIGEST);
    expect(tech.textContent).toContain("loopback:frame");
    const clone = screen.getByTestId("workflow-output-viewer").cloneNode(true) as HTMLElement;
    clone.querySelector('[data-testid="workflow-output-tech-details"]')!.remove();
    const visible = clone.textContent ?? "";
    expect(visible).not.toMatch(/loopback|S064|[0-9a-f]{64}/);
  });

  it("指标名与需求来源不露内部编号：loopback_metric / [loopback] / S067@ver 只在技术详情", async () => {
    api.getWorkflowInstanceOutput.mockResolvedValue(prdOutput({
      ...PRD,
      requirements: [{ id: "R1", text: "[loopback] requirement from S067@1.0.0", priority: "P1" }],
      metrics: [{ name: "loopback_metric", definition: "[loopback] deterministic metric" }, { name: "sync_success_rate", definition: "成功率" }],
    }));
    render(<WorkflowRunOutputPage params={{ instanceId: "i1" }} />);
    await waitFor(() => expect(screen.getByTestId("workflow-output-prd")).toBeTruthy());
    expect(screen.getByTestId("workflow-output-requirements").textContent).toContain("来自「PRD / 需求规格撰写」技能的需求");
    expect(screen.getByTestId("workflow-output-metrics").textContent).toContain("演示指标");
    expect(screen.getByTestId("workflow-output-tech-details").textContent).toContain("loopback_metric");
    const clone = screen.getByTestId("workflow-output-viewer").cloneNode(true) as HTMLElement;
    clone.querySelector('[data-testid="workflow-output-tech-details"]')!.remove();
    const visible = clone.textContent ?? "";
    expect(visible).not.toMatch(/loopback|S0\d\d@|[a-z0-9]+_[a-z0-9_]+/i);
  });

  it("尚无产出：空态", async () => {
    api.getWorkflowInstanceOutput.mockResolvedValue(prdOutput(null));
    render(<WorkflowRunOutputPage params={{ instanceId: "i1" }} />);
    await waitFor(() => expect(screen.getByTestId("workflow-output-empty")).toBeTruthy());
    expect(screen.queryByTestId("workflow-output-source")).toBeNull();
  });

  it("读取失败：按错误码给中文文案，可重试", async () => {
    api.getWorkflowInstanceOutput.mockRejectedValueOnce(new ApiError(404, "workflow_not_found", { code: "workflow_not_found" }));
    render(<WorkflowRunOutputPage params={{ instanceId: "i1" }} />);
    await waitFor(() => expect(screen.getByTestId("workflow-output-error")).toBeTruthy());
    expect(screen.getByTestId("workflow-output-error").textContent).not.toContain("workflow_not_found");
    api.getWorkflowInstanceOutput.mockResolvedValueOnce(prdOutput(PRD));
    fireEvent.click(screen.getByTestId("workflow-output-retry"));
    await waitFor(() => expect(screen.getByTestId("workflow-output-prd")).toBeTruthy());
  });
});
