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

async function editedChapter() {
  read.mockResolvedValue(runtimeFixture("report"));
  render(<GuidedResearchLive sessionId="grs-live" initialNode="report" visualStage="report" onBack={vi.fn()} />);
  const summary = await screen.findByText("调整报告章节");
  const details = summary.closest("details")!;
  details.open = true; fireEvent(details, new Event("toggle"));
  const input = await screen.findByRole("textbox", {name:"章节标题"});
  fireEvent.change(input, {target:{value:"编辑后的章节"}});
  return details;
}
it("keeps unsaved chapter edits through collapse and reopening", async () => {
  const details = await editedChapter();
  details.open = false; fireEvent(details, new Event("toggle"));
  expect(screen.getByDisplayValue("编辑后的章节")).toBeInTheDocument();
  details.open = true; fireEvent(details, new Event("toggle"));
  expect(await screen.findByRole("textbox", {name:"章节标题"})).toHaveValue("编辑后的章节");
  expect(screen.getByRole("button", {name:"保存章节结构"})).toBeEnabled();
  expect(execute).not.toHaveBeenCalled();
});
it("regenerates from the unlocked server node after saving chapters", async () => {
  const next = {...runtimeFixture("research"), version:5};
  execute.mockResolvedValueOnce(next).mockResolvedValueOnce(runtimeFixture("report"));
  await editedChapter();
  fireEvent.click(screen.getByRole("button", {name:"保存章节结构"}));
  await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByTestId("research-report-primary-action")).toBeEnabled());
  fireEvent.click(screen.getByTestId("research-report-primary-action"));
  await waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
  expect(execute.mock.calls[1]?.[0]).toMatchObject({node:"research",action:"generate_report"});
});

it("stops showing search loading once the composite server starts report writing", async () => {
  read.mockResolvedValue(runtimeFixture("outline"));
  execute.mockImplementation((_input, onEvent) => {
    onEvent({ type: "snapshot", state: { ...runtimeFixture("report"), version: 5, busy: true, completed: false, report: null, executionGoal: "report", leaseUntil: "2099-01-01T00:00:00Z" } });
    return new Promise(() => undefined);
  });
  render(<GuidedResearchLive sessionId="grs-live" onBack={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: /^生成报告$/ }));
  await screen.findByTestId("research-execution-timeline");
  expect(screen.queryByText("正在获取资料")).not.toBeInTheDocument();
  expect(screen.getByTestId("research-execution-timeline")).toHaveTextContent("正在执行研究计划");
});
