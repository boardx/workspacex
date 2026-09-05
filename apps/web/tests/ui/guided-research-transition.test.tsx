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
    ["brief", "directions", "generate"], ["directions", "outline", "generate"],
    ["outline", "research", "start"], ["research", "report", "generate"],
  ] as const)("%s immediately shows %s loading and waits for generated content", async (from, to, action) => {
    const before = runtimeFixture(from);
    const confirmed = { ...runtimeFixture(to), version: 5 };
    const generated = { ...confirmed, version: 6 };
    let confirm!: (state: GuidedResearchRuntime) => void;
    let generate!: (state: GuidedResearchRuntime) => void;
    vi.mocked(getResearchRuntime).mockResolvedValue(before);
    vi.mocked(executeResearchRuntime).mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { generate = resolve; }));
    render(<GuidedResearchLive sessionId={before.sessionId} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "确认并继续" }));
    expect(screen.getByTestId("research-step-loading")).toBeInTheDocument();
    expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
    await act(async () => { confirm(confirmed); });
    expect(executeResearchRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ node: to, action, expectedVersion: 5 }));
    expect(screen.getByTestId("research-step-loading")).toBeInTheDocument();
    await act(async () => { generate(generated); });
    expect(screen.queryByTestId("research-step-loading")).not.toBeInTheDocument();
    expect(screen.getByTestId(`research-flow-${to === "research" ? "search" : to}`)).toBeInTheDocument();
    expect(executeResearchRuntime).toHaveBeenCalledTimes(2);
  });
  it("keeps a failed confirmation on its original step without generating", async () => {
    const before = runtimeFixture("brief");
    vi.mocked(getResearchRuntime).mockResolvedValue(before);
    vi.mocked(executeResearchRuntime).mockResolvedValue({ ...before, version: 5, errorCode: "RESEARCH_MODEL_GENERATION_REQUIRED" });
    render(<GuidedResearchLive sessionId={before.sessionId} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "确认并继续" }));
    await waitFor(() => expect(screen.queryByTestId("research-step-loading")).not.toBeInTheDocument());
    expect(screen.getByTestId("research-flow-brief")).toBeInTheDocument();
    expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
  });
  it("stays on the next step after a model failure and retries only generation", async () => {
    const before = runtimeFixture("brief"), after = { ...runtimeFixture("directions"), version: 5 };
    vi.mocked(getResearchRuntime).mockResolvedValue(before);
    vi.mocked(executeResearchRuntime).mockResolvedValueOnce(after)
      .mockResolvedValueOnce({ ...after, version: 6, errorCode: "RESEARCH_WORKFLOW_UNAVAILABLE" })
      .mockResolvedValueOnce({ ...after, version: 7 });
    render(<GuidedResearchLive sessionId={before.sessionId} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "确认并继续" }));
    await screen.findByRole("alert");
    expect(screen.getByTestId("research-flow-directions")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "使用模型生成" }));
    await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalledTimes(3));
    expect(executeResearchRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ node: "directions", action: "generate", expectedVersion: 6 }));
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
  vi.mocked(executeResearchRuntime).mockResolvedValueOnce(next).mockRejectedValueOnce(new Error("disconnected"));
  render(<GuidedResearchLive sessionId={before.sessionId} onBack={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "确认并继续" }));
  await waitFor(() => expect(screen.queryByTestId("research-step-loading")).not.toBeInTheDocument());
  expect(screen.getByTestId("research-flow-directions")).toBeInTheDocument();
  expect(screen.queryByTestId("research-recovery")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "使用模型生成" })).toBeEnabled();
  expect(executeResearchRuntime).toHaveBeenCalledTimes(2);
});
