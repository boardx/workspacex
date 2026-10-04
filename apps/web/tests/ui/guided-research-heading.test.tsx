import * as React from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { GuidedResearchLive } from "@/components/research-studio/guided-research-live";
import { getResearchRuntime, getResearchRuntimeProgress, executeResearchRuntime } from "@/lib/guided-research-api";
import { runtimeFixture } from "../guided-runtime-fixture";
vi.mock("@/lib/guided-research-api", async (original) => ({ ...await original<typeof import("@/lib/guided-research-api")>(), getResearchRuntime: vi.fn(), getResearchRuntimeProgress: vi.fn(), executeResearchRuntime: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getResearchRuntimeProgress).mockRejectedValue(new Error("offline")); });
afterEach(() => vi.useRealTimers());
const goal = "公开合成研究需求。".repeat(4000);
it("shows a concise default before brief generation rather than a long-input excerpt", async () => {
  const state = { ...runtimeFixture("directions"), generatedNodes: [], brief: { ...runtimeFixture().brief, goal, topic: goal.slice(0, 200) } };
  vi.mocked(getResearchRuntime).mockResolvedValue(state);
  render(<GuidedResearchLive sessionId={state.sessionId} onBack={vi.fn()} />);
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(/^新建研究$/);
});
it.each([false, true])("preserves an explicit user title before/after generated brief (%s)", async generated => {
  const state = { ...runtimeFixture("directions"), generatedNodes: generated ? ["brief" as const] : [] };
  vi.mocked(getResearchRuntime).mockResolvedValue(state);
  render(<GuidedResearchLive sessionId={state.sessionId} researchName="用户显式命名" onBack={vi.fn()} />);
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(/^用户显式命名$/);
});
it("restores a saved generated topic when the session still has the default metadata title", async () => {
  const state = runtimeFixture("directions");
  vi.mocked(getResearchRuntime).mockResolvedValue(state);
  render(<GuidedResearchLive sessionId={state.sessionId} researchName="新建研究" onBack={vi.fn()} />);
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(state.brief.topic);
});
it("keeps the concise name after generation fails and recovery reloads ungenerated input", async () => {
  const state = { ...runtimeFixture("report"), report: null, generatedNodes: [], brief: { ...runtimeFixture().brief, goal, topic: goal.slice(0, 200) } };
  vi.mocked(getResearchRuntime).mockResolvedValue(state);
  vi.mocked(executeResearchRuntime).mockRejectedValue(new Error("offline"));
  render(<GuidedResearchLive sessionId={state.sessionId} researchName="新建研究" onBack={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "生成报告" }));
  await act(async () => {});
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^新建研究$/);
  expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
});
it("switches to the saved generated topic and rejects a late lower-revision snapshot", async () => {
  const state = { ...runtimeFixture("report"), report: null, generatedNodes: [] };
  vi.mocked(getResearchRuntime).mockResolvedValue(state);
  let emit!: NonNullable<Parameters<typeof executeResearchRuntime>[1]>;
  vi.mocked(executeResearchRuntime).mockImplementation((_input, callback) => { emit = callback!; return new Promise(() => {}); });
  render(<GuidedResearchLive sessionId={state.sessionId} researchName="新建研究" onBack={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "生成报告" }));
  const saved = { ...state, version: state.version + 1, revision: 3, busy: true, leaseUntil: "2099-01-01T00:00:00Z", generatedNodes: ["brief" as const], brief: { ...state.brief, topic: "模型保存的简洁题名" } };
  await act(async () => emit({ type: "snapshot", state: saved }));
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^模型保存的简洁题名$/);
  await act(async () => emit({ type: "snapshot", state: { ...saved, revision: 2, brief: { ...saved.brief, topic: "迟到的旧题名" } } }));
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^模型保存的简洁题名$/);
});

it.each([100])("does not treat an old %s-character requirement-derived metadata name as explicit", async length => {
  const state = { ...runtimeFixture("directions"), generatedNodes: [], brief: { ...runtimeFixture().brief, goal, topic: goal.slice(0, 200) } };
  vi.mocked(getResearchRuntime).mockResolvedValue(state);
  render(<GuidedResearchLive sessionId={state.sessionId} researchName={goal.slice(0, length)} onBack={vi.fn()} />);
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(/^新建研究$/);
});
it.each([100])("restores the saved generated topic despite an old %s-character automatic name", async length => {
  const state = { ...runtimeFixture("directions"), brief: { ...runtimeFixture().brief, goal, topic: "模型保存的简洁题名" } };
  vi.mocked(getResearchRuntime).mockResolvedValue(state);
  render(<GuidedResearchLive sessionId={state.sessionId} researchName={goal.slice(0, length)} onBack={vi.fn()} />);
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(/^模型保存的简洁题名$/);
});

it("recognizes the automatic metadata prefix when the goal is between title and topic limits", async () => {
  const goal = "公开合成中等需求。".repeat(17);
  const state = { ...runtimeFixture("directions"), generatedNodes: [], brief: { ...runtimeFixture().brief, goal, topic: goal } };
  vi.mocked(getResearchRuntime).mockResolvedValue(state);
  render(<GuidedResearchLive sessionId={state.sessionId} researchName={goal.slice(0, 100)} onBack={vi.fn()} />);
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(/^新建研究$/);
});
it("preserves independent newer stream sequences without rolling back the saved heading", async () => {
  const state = { ...runtimeFixture("report"), report: null };
  vi.mocked(getResearchRuntime).mockResolvedValue(state);
  let emit!: NonNullable<Parameters<typeof executeResearchRuntime>[1]>;
  let requestId = "";
  vi.mocked(executeResearchRuntime).mockImplementation((input, callback) => { requestId = input.requestId; emit = callback!; return new Promise(() => {}); });
  render(<GuidedResearchLive sessionId={state.sessionId} researchName="新建研究" onBack={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "生成报告" }));
  const saved = { ...state, version: state.version + 1, revision: 3, busy: true, leaseUntil: "2099-01-01T00:00:00Z", brief: { ...state.brief, topic: "已保存题名" }, reportStream: { requestId, sequence: 0, text: '{"summary":"', status: "streaming" as const } };
  await act(async () => emit({ type: "snapshot", state: saved }));
  await act(async () => emit({ type: "report_delta", sessionId: state.sessionId, requestId, version: saved.version, sequence: 1, delta: "独立流正文" }));
  expect(screen.getByText("独立流正文")).toBeInTheDocument();
  await act(async () => emit({ type: "snapshot", state: { ...saved, revision: 2, brief: { ...saved.brief, topic: "旧题名" }, reportStream: { ...saved.reportStream, sequence: 2, text: '{"summary":"更新流正文' } } }));
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^已保存题名$/);
  expect(screen.getByText("更新流正文")).toBeInTheDocument();
});
