import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { runtimeFixture } from "../guided-runtime-fixture";
import { GuidedResearchLive } from "@/components/research-studio/guided-research-live";
const { read, execute } = vi.hoisted(() => ({ read: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/guided-research-api", () => ({ getResearchRuntime: read, getResearchRuntimeProgress: vi.fn(), executeResearchRuntime: execute, mergeResearchProgress: vi.fn((_current, next) => next) }));
vi.mock("@/lib/guided-research-memory", () => ({ readResearchMemory: () => undefined, writeResearchMemory: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); });

it("prepares the complete plan once for a newly created confirmed intake", async () => {
  read.mockResolvedValue({ ...runtimeFixture("brief"), version: 0, generatedNodes: [] });
  execute.mockResolvedValue(runtimeFixture("outline"));
  render(<GuidedResearchLive sessionId="grs-live" initialNode="outline" visualStage="plan" onBack={vi.fn()} />);
  await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
  expect(execute.mock.calls[0]?.[0]).toMatchObject({ node: "brief", action: "prepare_plan", expectedVersion: 0 });
  expect(execute.mock.calls[0]?.[1]).toEqual(expect.any(Function));
  expect(await screen.findByTestId("guided-research-plan-panel")).toBeVisible();
});

it("restores a legacy research link into the report step without replay, then starts one durable report command", async () => {
  read.mockResolvedValue(runtimeFixture("research"));
  execute.mockResolvedValue({ ...runtimeFixture("report"), completed: true });
  render(<GuidedResearchLive sessionId="grs-live" initialNode="research" visualStage="research" onBack={vi.fn()} />);
  const progress = within(await screen.findByTestId("research-flow-progress"));
  await screen.findByTestId("guided-research-source-evidence");
  expect(execute).not.toHaveBeenCalled();
  expect(progress.getAllByRole("listitem")).toHaveLength(3);
  expect(progress.queryByText("资料研究")).toBeNull();
  expect(screen.queryByRole("button", { name: "确认并继续" })).toBeNull();
  fireEvent.click(screen.getByTestId("research-report-primary-action"));
  await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
  expect(execute.mock.calls[0]?.[0]).toMatchObject({ node: "research", action: "generate_report" });
  expect(execute.mock.calls[0]?.[1]).toEqual(expect.any(Function));
});

it("keeps a failed historical topic on the plan step until explicit retry", async () => {
  read.mockResolvedValue({ ...runtimeFixture("directions"), errorCode: "RESEARCH_WORKFLOW_UNAVAILABLE" });
  render(<GuidedResearchLive sessionId="grs-live" initialNode="directions" visualStage="topic" onBack={vi.fn()} />);
  expect(await screen.findByRole("button", { name: "生成研究计划" })).toBeVisible();
  expect(execute).not.toHaveBeenCalled();
  expect(window.location.pathname).toBe("/research/grs-live/plan");
});
