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
