import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GuidedResearchLive } from "@/components/research-studio/guided-research-live";
import { executeResearchRuntime, getResearchRuntime, type GuidedResearchRuntime } from "@/lib/guided-research-api";
import { runtimeFixture } from "../guided-runtime-fixture";
vi.mock("@/lib/guided-research-api", () => ({ executeResearchRuntime: vi.fn(), getResearchRuntime: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
describe("confirm and generate the next research step", () => {
  it.each([
    ["brief", "directions"], ["directions", "outline"],
    ["outline", "research"], ["research", "report"],
  ] as const)("%s immediately shows %s loading and waits for generated content", async (from, to) => {
    const before = runtimeFixture(from);
    const generated = { ...runtimeFixture(to), version: 5 };
    let confirm!: (state: GuidedResearchRuntime) => void;
    vi.mocked(getResearchRuntime).mockResolvedValue(before);
    vi.mocked(executeResearchRuntime).mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }));
    render(<GuidedResearchLive sessionId={before.sessionId} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "确认并继续" }));
    expect(screen.getByTestId("research-step-loading")).toBeInTheDocument();
    expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
    expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({ node: from, action: from === "research" ? "complete" : "confirm" }));
    await act(async () => { confirm(generated); });
    expect(screen.queryByTestId("research-step-loading")).not.toBeInTheDocument();
    expect(screen.getByTestId(`research-flow-${to === "research" ? "search" : to}`)).toBeInTheDocument();
    expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
  });
  it("keeps a failed confirmation on its original step without generating", async () => {
    const before = runtimeFixture("brief");
    vi.mocked(getResearchRuntime).mockResolvedValue(before);
    vi.mocked(executeResearchRuntime).mockResolvedValue({ ...before, version: 5, errorCode: "RESEARCH_WORKFLOW_UNAVAILABLE" });
    render(<GuidedResearchLive sessionId={before.sessionId} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "确认并继续" }));
    await waitFor(() => expect(screen.queryByTestId("research-step-loading")).not.toBeInTheDocument());
    expect(screen.getByTestId("research-flow-brief")).toBeInTheDocument();
    expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
  });
  it("stays on the next step after a model failure and retries only generation", async () => {
    const before = runtimeFixture("brief"), after = { ...runtimeFixture("directions"), version: 5 };
    vi.mocked(getResearchRuntime).mockResolvedValue(before);
    vi.mocked(executeResearchRuntime).mockResolvedValueOnce({ ...after, version: 5, errorCode: "RESEARCH_WORKFLOW_UNAVAILABLE" })
      .mockResolvedValueOnce({ ...after, version: 7 });
    render(<GuidedResearchLive sessionId={before.sessionId} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "确认并继续" }));
    await screen.findByRole("alert");
    expect(screen.getByTestId("research-flow-directions")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新生成本步骤" }));
    await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalledTimes(2));
    expect(executeResearchRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ node: "directions", action: "generate", expectedVersion: 5 }));
  });
  it("does not start generation if the user switched sessions during confirmation", async () => {
    let confirm!: (state: GuidedResearchRuntime) => void;
    vi.mocked(getResearchRuntime).mockResolvedValueOnce(runtimeFixture("brief", "first"))
      .mockResolvedValueOnce(runtimeFixture("brief", "second"));
    vi.mocked(executeResearchRuntime).mockImplementation(() => new Promise(resolve => { confirm = resolve; }));
    const view = render(<GuidedResearchLive sessionId="first" onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "确认并继续" }));
    view.rerender(<GuidedResearchLive sessionId="second" onBack={vi.fn()} />);
    await screen.findByDisplayValue("储能研究");
    await act(async () => { confirm({ ...runtimeFixture("directions", "first"), version: 5 }); });
    expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("research-step-loading")).not.toBeInTheDocument();
  });
});

it("does not auto-generate from a newer collaborator snapshot", async () => {
  let confirm!: (state: GuidedResearchRuntime) => void;
  const before = runtimeFixture("brief");
  vi.mocked(getResearchRuntime).mockResolvedValueOnce(before).mockResolvedValue({ ...runtimeFixture("directions"), version: 8 });
  vi.mocked(executeResearchRuntime).mockImplementation(() => new Promise(resolve => { confirm = resolve; }));
  vi.useFakeTimers();
  try {
    await act(async () => { render(<GuidedResearchLive sessionId={before.sessionId} onBack={vi.fn()} />); });
    fireEvent.click(screen.getByRole("button", { name: "确认并继续" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    await act(async () => { confirm({ ...runtimeFixture("directions"), version: 5 }); });
    expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("research-step-loading")).not.toBeInTheDocument();
  } finally { vi.useRealTimers(); }
});

it("does not resume an old confirmation after switching away and back to the same session", async () => {
  let confirm!: (state: GuidedResearchRuntime) => void;
  vi.mocked(getResearchRuntime).mockResolvedValueOnce(runtimeFixture("brief", "first"))
    .mockResolvedValueOnce(runtimeFixture("brief", "second")).mockResolvedValueOnce(runtimeFixture("brief", "first"));
  vi.mocked(executeResearchRuntime).mockImplementation(() => new Promise(resolve => { confirm = resolve; }));
  const view = render(<GuidedResearchLive sessionId="first" onBack={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "确认并继续" }));
  view.rerender(<GuidedResearchLive sessionId="second" onBack={vi.fn()} />);
  await screen.findByDisplayValue("储能研究");
  view.rerender(<GuidedResearchLive sessionId="first" onBack={vi.fn()} />);
  await screen.findByDisplayValue("储能研究");
  await act(async () => { confirm({ ...runtimeFixture("directions", "first"), version: 5 }); });
  expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("research-flow-brief")).toBeInTheDocument();
});

it("restores the next step without a redundant conflict panel when there is no local draft", async () => {
  const before = runtimeFixture("brief");
  const next = { ...runtimeFixture("directions"), version: 5 };
  vi.mocked(getResearchRuntime).mockResolvedValueOnce(before).mockResolvedValue(next);
  vi.mocked(executeResearchRuntime).mockRejectedValueOnce(new Error("disconnected"));
  render(<GuidedResearchLive sessionId={before.sessionId} onBack={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "确认并继续" }));
  await waitFor(() => expect(screen.queryByTestId("research-step-loading")).not.toBeInTheDocument());
  expect(screen.getByTestId("research-flow-directions")).toBeInTheDocument();
  expect(screen.queryByTestId("research-recovery")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "重新生成本步骤" })).toBeEnabled();
  expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
});

it.each(["brief", "directions", "outline"] as const)("reconfirms an available historical %s without requiring manual generation", async (node) => {
  const current = { ...runtimeFixture("research"), generatedNodes: [] };
  vi.mocked(getResearchRuntime).mockResolvedValue(current);
  let finish!: (value: GuidedResearchRuntime) => void;
  vi.mocked(executeResearchRuntime).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<GuidedResearchLive sessionId={current.sessionId} initialNode={node} onBack={vi.fn()} />);
  const confirm = await screen.findByRole("button", { name: "确认并继续" });
  expect(confirm).toBeEnabled();
  fireEvent.click(confirm);
  expect(screen.getByTestId("research-step-loading")).toBeInTheDocument();
  expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({ node, action: "confirm", draft: expect.objectContaining({ node }) }));
  await act(async () => { finish(runtimeFixture(node === "brief" ? "directions" : node === "directions" ? "outline" : "research")); });
  expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
});

it("does not display a research error while viewing an earlier step", async () => {
  vi.mocked(getResearchRuntime).mockResolvedValue({ ...runtimeFixture("research"), errorCode: "RESEARCH_SEARCH_PARTIAL_FAILURE" });
  render(<GuidedResearchLive sessionId={runtimeFixture("research").sessionId} initialNode="brief" onBack={vi.fn()} />);
  await screen.findByDisplayValue("储能研究");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("follows a restored active confirmation when polling advances to the next step", async () => {
  const running = { ...runtimeFixture("brief"), busy: true, leaseUntil: "2099-01-01T00:00:00.000Z" };
  const finished = { ...runtimeFixture("directions"), version: running.version };
  vi.mocked(getResearchRuntime).mockResolvedValueOnce(running).mockResolvedValue(finished);
  vi.useFakeTimers();
  try {
    await act(async () => { render(<GuidedResearchLive sessionId={running.sessionId} onBack={vi.fn()} />); });
    expect(screen.getByTestId("research-step-loading")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByTestId("research-flow-directions")).toBeInTheDocument();
    expect(screen.queryByTestId("research-step-loading")).not.toBeInTheDocument();
    expect(executeResearchRuntime).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
