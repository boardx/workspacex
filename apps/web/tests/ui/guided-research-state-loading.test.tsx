import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { GuidedResearchLive } from "@/components/research-studio/guided-research-live";
import { executeResearchRuntime, getResearchRuntime, getResearchRuntimeProgress } from "@/lib/guided-research-api";
import { getStoredSessionToken } from "@/lib/api-client";
import { readResearchMemory, writeResearchMemory } from "@/lib/guided-research-memory";
import { runtimeFixture } from "../guided-runtime-fixture";
vi.mock("@/lib/api-client", async (original) => ({ ...await original<typeof import("@/lib/api-client")>(), getStoredSessionToken: vi.fn() }));
vi.mock("@/lib/guided-research-api", async (original) => ({ ...await original<typeof import("@/lib/guided-research-api")>(), executeResearchRuntime: vi.fn(), getResearchRuntime: vi.fn(), getResearchRuntimeProgress: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getStoredSessionToken).mockReturnValue(null); readResearchMemory("grs-live");
  vi.mocked(getStoredSessionToken).mockReturnValue("account");
});
it("hydrates a fresh page from one complete snapshot", async () => {
  const state = runtimeFixture("outline");
  vi.mocked(getResearchRuntime).mockResolvedValue(state);
  render(<GuidedResearchLive sessionId={state.sessionId} onBack={vi.fn()} />);
  await screen.findByTestId("guided-research-plan-panel");
  expect(getResearchRuntime).toHaveBeenCalledTimes(1);
  expect(getResearchRuntimeProgress).not.toHaveBeenCalled();
});
it("uses cached step data plus changed fields when returning to another step", async () => {
  const state = runtimeFixture("outline");
  writeResearchMemory(state.sessionId, { runtime: state }, "account");
  vi.mocked(getResearchRuntimeProgress).mockResolvedValue({ type: "patch", sessionId: state.sessionId, version: state.version, revision: state.revision, changes: {}, removed: [] });
  render(<GuidedResearchLive sessionId={state.sessionId} initialNode="directions" visualStage="topic" onBack={vi.fn()} />);
  expect(await screen.findByTestId("research-plan-recovery")).toHaveTextContent(state.brief.goal);
  expect(getResearchRuntime).not.toHaveBeenCalled();
  expect(getResearchRuntimeProgress).toHaveBeenCalledWith(state.sessionId, state.reportStream, undefined, state);
  expect(readResearchMemory(state.sessionId)?.runtime?.outline).toEqual(state.outline);
});

afterEach(() => vi.useRealTimers());
it("does not apply an old poll patch over newer streamed text and timeline", async () => {
  const initial = { ...runtimeFixture("report"), report: null };
  vi.mocked(getResearchRuntime).mockResolvedValue(initial);
  let emit!: NonNullable<Parameters<typeof executeResearchRuntime>[1]>;
  let requestId = "";
  vi.mocked(executeResearchRuntime).mockImplementation((input, callback) => { requestId = input.requestId; emit = callback!; return new Promise(() => undefined); });
  let finish!: (patch: Awaited<ReturnType<typeof getResearchRuntimeProgress>>) => void;
  vi.mocked(getResearchRuntimeProgress).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  vi.useFakeTimers();
  await act(async () => { render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />); });
  fireEvent.click(screen.getByRole("button", { name: "生成报告" }));
  const current = { ...initial, version: 5, busy: true, leaseUntil: "2099-01-01T00:00:00Z", reportStream: { requestId, sequence: 1, text: '{"summary":"已生成', status: "streaming" as const }, reportTimeline: [{ id: "chapter", sectionId: "o1", stage: "chapter" as const, status: "completed" as const, attempts: 1 }] };
  await act(async () => emit({ type: "snapshot", state: current }));
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  await act(async () => emit({ type: "report_delta", sessionId: initial.sessionId, requestId, version: 5, sequence: 2, delta: "正文" }));
  await act(async () => finish({ type: "patch", sessionId: initial.sessionId, version: 5, revision: current.revision, changes: { reportTimeline: [{ ...current.reportTimeline[0]!, status: "running" }] }, removed: [] }));
  expect(screen.getByText("已生成正文")).toBeInTheDocument();
  expect(screen.getByTestId("execution-chapters")).toHaveTextContent("已完成");
});

it("renders cached content before a delayed validation finishes", () => {
  const state = runtimeFixture("brief");
  writeResearchMemory(state.sessionId, { runtime: state }, "account");
  vi.mocked(getResearchRuntimeProgress).mockImplementation(() => new Promise(() => undefined));
  render(<GuidedResearchLive sessionId={state.sessionId} initialNode="brief" visualStage="import" onBack={vi.fn()} />);
  expect(screen.getByRole("textbox", { name: "研究需求" })).toHaveValue(state.brief.goal);
  expect(executeResearchRuntime).not.toHaveBeenCalled();
});

it("retains edits during route validation and accepts newer backend data", async () => {
  const state = runtimeFixture("outline");
  vi.mocked(getResearchRuntime).mockResolvedValue(state);
  const view = render(<GuidedResearchLive sessionId={state.sessionId} initialNode="brief" visualStage="import" onBack={vi.fn()} />);
  await screen.findByRole("textbox", { name: "研究需求" });
  fireEvent.change(screen.getByRole("textbox", { name: "研究需求" }), { target: { value: "本地未保存研究需求" } });
  let resolve!: (value: Awaited<ReturnType<typeof getResearchRuntimeProgress>>) => void;
  vi.mocked(getResearchRuntimeProgress).mockImplementation(() => new Promise((done) => { resolve = done; }));
  view.rerender(<GuidedResearchLive sessionId={state.sessionId} initialNode="outline" visualStage="plan" onBack={vi.fn()} />);
  expect(screen.getByTestId("guided-research-plan-panel")).toBeInTheDocument();
  await act(async () => resolve({ type: "patch", sessionId: state.sessionId, version: state.version + 1, revision: state.revision + 1, changes: { brief: { ...state.brief, goal: "后端更新需求" } }, removed: [] }));
  view.rerender(<GuidedResearchLive sessionId={state.sessionId} initialNode="brief" visualStage="import" onBack={vi.fn()} />);
  expect(screen.getByRole("textbox", { name: "研究需求" })).toHaveValue("本地未保存研究需求");
  expect(readResearchMemory(state.sessionId)?.runtime?.brief.goal).toBe("后端更新需求");
  expect(executeResearchRuntime).not.toHaveBeenCalled();
});

it("keeps cached content on validation failure and retries without execution", async () => {
  const state = runtimeFixture("brief");
  writeResearchMemory(state.sessionId, { runtime: state }, "account");
  vi.mocked(getResearchRuntimeProgress).mockRejectedValue(new Error("offline"));
  const view = render(<GuidedResearchLive sessionId={state.sessionId} initialNode="brief" onBack={vi.fn()} />);
  await screen.findByRole("alert");
  expect(screen.getByRole("textbox", { name: "研究需求" })).toHaveValue(state.brief.goal);
  view.rerender(<GuidedResearchLive sessionId={state.sessionId} initialNode="brief" visualStage="import" onBack={vi.fn()} />);
  expect(executeResearchRuntime).not.toHaveBeenCalled();
});

it("never displays another research or credential's cached data", async () => {
  const first = runtimeFixture("brief", "first");
  vi.mocked(getResearchRuntime).mockImplementation(async (id) => id === "first" ? first : new Promise(() => undefined));
  const view = render(<GuidedResearchLive sessionId="first" onBack={vi.fn()} />);
  await screen.findByRole("textbox", { name: "研究需求" });
  view.rerender(<GuidedResearchLive sessionId="second" onBack={vi.fn()} />);
  expect(screen.queryByRole("textbox", { name: "研究需求" })).not.toBeInTheDocument();
  vi.mocked(getStoredSessionToken).mockReturnValue("another-account");
  view.rerender(<GuidedResearchLive sessionId="first" onBack={vi.fn()} />);
  expect(screen.queryByRole("textbox", { name: "研究需求" })).not.toBeInTheDocument();
});

it("preserves an edit made while a hot-cache read is in flight", async () => {
  const state = runtimeFixture("brief");
  writeResearchMemory(state.sessionId, { runtime: state }, "account");
  let finish!: (patch: Awaited<ReturnType<typeof getResearchRuntimeProgress>>) => void;
  vi.mocked(getResearchRuntimeProgress).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<GuidedResearchLive sessionId={state.sessionId} initialNode="brief" onBack={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox", { name: "研究需求" }), { target: { value: "保留正在编辑的需求" } });
  await act(async () => finish({ type: "patch", sessionId: state.sessionId, version: state.version + 1, revision: state.revision + 1, changes: { brief: { ...state.brief, goal: "远端新需求" } }, removed: [] }));
  expect(screen.getByRole("textbox", { name: "研究需求" })).toHaveValue("保留正在编辑的需求");
  expect(readResearchMemory(state.sessionId)?.runtime?.brief.goal).toBe("远端新需求");
});

it.each([401, 403, 404])("removes cached research after an explicit HTTP %i access rejection", async (status) => {
  const state = runtimeFixture("brief");
  writeResearchMemory(state.sessionId, { runtime: state }, "account");
  const { ApiError } = await import("@/lib/api-client");
  vi.mocked(getResearchRuntimeProgress).mockRejectedValue(new ApiError(status, "RESEARCH_ACCESS_DENIED", null));
  render(<GuidedResearchLive sessionId={state.sessionId} initialNode="brief" onBack={vi.fn()} />);
  await screen.findByRole("button", { name: "重试加载" });
  expect(screen.queryByRole("textbox", { name: "研究需求" })).not.toBeInTheDocument();
  expect(readResearchMemory(state.sessionId)).toBeUndefined();
});

it("protects local edits when validation discovers a remote execution and starts polling", async () => {
  const state = runtimeFixture("brief");
  writeResearchMemory(state.sessionId, { runtime: state }, "account");
  let finish!: (patch: Awaited<ReturnType<typeof getResearchRuntimeProgress>>) => void;
  const busy = { ...state, version: state.version + 1, busy: true, leaseUntil: "2099-01-01T00:00:00Z" };
  vi.mocked(getResearchRuntimeProgress)
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValue({ type: "patch", sessionId: state.sessionId, version: busy.version, revision: busy.revision + 1, changes: { busy: false, leaseUntil: null, brief: { ...state.brief, goal: "远端执行中的需求" } }, removed: [] });
  vi.useFakeTimers();
  await act(async () => { render(<GuidedResearchLive sessionId={state.sessionId} initialNode="brief" onBack={vi.fn()} />); });
  fireEvent.change(screen.getByRole("textbox", { name: "研究需求" }), { target: { value: "保留的本地需求" } });
  await act(async () => finish({ type: "patch", sessionId: state.sessionId, version: busy.version, revision: busy.revision, changes: { busy: true, leaseUntil: busy.leaseUntil }, removed: [] }));
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(getResearchRuntimeProgress).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("textbox", { name: "研究需求" })).toHaveValue("保留的本地需求");
});

it("does not let a delayed navigation read overwrite a newer explicit command", async () => {
  const state = runtimeFixture("brief");
  writeResearchMemory(state.sessionId, { runtime: state }, "account");
  let finish!: (patch: Awaited<ReturnType<typeof getResearchRuntimeProgress>>) => void;
  vi.mocked(getResearchRuntimeProgress).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const result = { ...runtimeFixture("outline"), version: state.version + 1 };
  vi.mocked(executeResearchRuntime).mockResolvedValue(result);
  render(<GuidedResearchLive sessionId={state.sessionId} initialNode="brief" onBack={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "确认并继续" }));
  await screen.findByTestId("guided-research-plan-panel");
  await act(async () => finish({ type: "patch", sessionId: state.sessionId, version: state.version, revision: state.revision, changes: { brief: { ...state.brief, goal: "旧需求" } }, removed: [] }));
  expect(screen.getByTestId("guided-research-plan-panel")).toBeInTheDocument();
  expect(readResearchMemory(state.sessionId)?.runtime?.version).toBe(result.version);
  expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
});

it("deduplicates a cold read across React StrictMode mounts", async () => {
  let finish!: (value: ReturnType<typeof runtimeFixture>) => void;
  vi.mocked(getResearchRuntime).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<React.StrictMode><GuidedResearchLive sessionId="strict" onBack={vi.fn()} /></React.StrictMode>);
  expect(getResearchRuntime).toHaveBeenCalledTimes(1);
  await act(async () => finish(runtimeFixture("brief", "strict")));
  expect(screen.getByRole("textbox", { name: "研究需求" })).toHaveValue("评估进入策略");
});

it("does not bootstrap from a warm version-zero cache before route validation succeeds", async () => {
  const cached = { ...runtimeFixture("brief"), version: 0, generatedNodes: [] };
  writeResearchMemory(cached.sessionId, { runtime: cached }, "account");
  let finish!: (patch: Awaited<ReturnType<typeof getResearchRuntimeProgress>>) => void;
  vi.mocked(getResearchRuntimeProgress).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  vi.mocked(executeResearchRuntime).mockResolvedValue(runtimeFixture("outline"));
  render(<GuidedResearchLive sessionId={cached.sessionId} initialNode="outline" visualStage="plan" onBack={vi.fn()} />);
  expect(executeResearchRuntime).not.toHaveBeenCalled();
  await act(async () => finish({ type: "patch", sessionId: cached.sessionId, version: 4, revision: 2, changes: { currentNode: "outline", availableNodes: ["brief", "directions", "outline"] }, removed: [] }));
  expect(executeResearchRuntime).not.toHaveBeenCalled();
});
it("does not bootstrap from a stale cache when the route read denies access", async () => {
  const cached = { ...runtimeFixture("brief"), version: 0, generatedNodes: [] };
  writeResearchMemory(cached.sessionId, { runtime: cached }, "account");
  const { ApiError } = await import("@/lib/api-client");
  vi.mocked(getResearchRuntimeProgress).mockRejectedValue(new ApiError(403, "FORBIDDEN", null));
  vi.mocked(executeResearchRuntime).mockImplementation(() => new Promise(() => undefined));
  render(<GuidedResearchLive sessionId={cached.sessionId} initialNode="outline" visualStage="plan" onBack={vi.fn()} />);
  await screen.findByRole("button", { name: "重试加载" });
  expect(executeResearchRuntime).not.toHaveBeenCalled();
});

it("bootstraps a newly confirmed warm intake only after successful route validation", async () => {
  const cached = { ...runtimeFixture("brief"), version: 0, generatedNodes: [] };
  writeResearchMemory(cached.sessionId, { runtime: cached }, "account");
  let finish!: (patch: Awaited<ReturnType<typeof getResearchRuntimeProgress>>) => void;
  vi.mocked(getResearchRuntimeProgress).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  vi.mocked(executeResearchRuntime).mockResolvedValue(runtimeFixture("outline"));
  render(<GuidedResearchLive sessionId={cached.sessionId} initialNode="outline" visualStage="plan" onBack={vi.fn()} />);
  expect(executeResearchRuntime).not.toHaveBeenCalled();
  await act(async () => finish({ type: "patch", sessionId: cached.sessionId, version: 0, revision: cached.revision, changes: {}, removed: [] }));
  await screen.findByTestId("guided-research-plan-panel");
  expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
  expect(vi.mocked(executeResearchRuntime).mock.calls[0]?.[0]).toMatchObject({ action: "prepare_plan", expectedVersion: 0 });
});
