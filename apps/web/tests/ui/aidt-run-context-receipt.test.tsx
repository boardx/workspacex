import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AidtContextReceipt } from "@repo/contracts/aidt-run-context";
import { AidtRunContextReceipt } from "@/features/aidt/components/aidt-run-context-receipt";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/features/aidt/lib/live-aidt-run-context", () => ({ readAidtRunContext: mocks.read }));
const props = { projectId: "p", threadId: "thread", runId: "r", sessionToken: "token", lifecycleKey: "actor-1", expected: { purpose: "stage" as const, stageId: 1 as const } };
function receipt(state: AidtContextReceipt["application"]["state"] = "prepared"): AidtContextReceipt { return { runId: "r", projectId: "p", purpose: "stage", stageId: 1, skillVersionId: "skill-v1", snapshotHash: "a".repeat(64), preparedAt: "2026-11-16T00:00:00Z", stageRevisions: [{ stageId: 1, revision: 2 }], historyRevisions: [], omissions: [], truncated: false, application: { state, attemptId: null, assembledContextHash: null, assembledAt: null, messageDispatchedAt: null, checkpointResumedAt: null, inheritedMessageDispatchAttemptId: null } }; }
function expand() { const node = screen.getByTestId("aidt-run-context-receipt"); node.setAttribute("open", ""); fireEvent(node, new Event("toggle")); }
beforeEach(() => { vi.clearAllMocks(); mocks.read.mockResolvedValue(receipt()); });
afterEach(() => vi.useRealTimers());
it("is hidden without an accepted run, and does not fetch while collapsed", async () => {
  const view = render(<AidtRunContextReceipt {...props} runId={null} />); expect(screen.queryByTestId("aidt-run-context-receipt")).toBeNull();
  view.rerender(<AidtRunContextReceipt {...props} />); expect(mocks.read).not.toHaveBeenCalled();
  expand(); await screen.findByText(/这只表示来源已保存到本轮快照/);
  expect(screen.getByText("第 1 步 · V2")).toBeVisible(); expect(screen.queryByText(/^材料已随本轮消息派发/)).toBeNull();
});
it("opens a selected entity at the frozen revision", async () => {
  mocks.read.mockResolvedValue({ ...receipt(), entityReferences:[{stageId:1,revision:7,entityId:"problem-a"}] });
  render(<AidtRunContextReceipt {...props} />); expand();
  const link=await screen.findByRole("link",{name:/查看第 1 步来源 · V7/});
  expect(link).toHaveAttribute("href","/aidt/p?step=1&entity=problem-a&entityRevision=7");
});
it("shows actual dispatch metadata and keeps source hashes folded", async () => {
  mocks.read.mockResolvedValue({ ...receipt("message-dispatch-observed"), truncated: true });
  render(<AidtRunContextReceipt {...props} />); expand(); await screen.findByText(/派发或续跑回执不代表模型判断正确/);
  expect(screen.getByText(/本轮只使用了部分摘录/)).toBeVisible(); expect(screen.getByText("a".repeat(64))).not.toBeVisible();
});
it("treats failure as unknown, preserves a retry, and does not reuse the prior successful body", async () => {
  mocks.read.mockRejectedValueOnce(new Error("private transport error"));
  render(<AidtRunContextReceipt {...props} />); expand(); await screen.findByRole("alert");
  expect(screen.queryByText(/private transport/)).toBeNull(); expect(screen.queryByText("第 1 步 · V2")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "刷新回执" })); await screen.findByText("第 1 步 · V2");
});
it("rejects a receipt for the wrong task even when project and run are valid", async () => {
  mocks.read.mockResolvedValue({ ...receipt(), stageId: 2 }); render(<AidtRunContextReceipt {...props} />); expand(); await screen.findByRole("alert"); expect(screen.queryByText("第 1 步 · V2")).toBeNull();
});
it("cancels A→B→A and ignores a late result from the first A", async () => {
  let finish!: (value: AidtContextReceipt) => void;
  mocks.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const view = render(<AidtRunContextReceipt {...props} />); expand(); await waitFor(() => expect(mocks.read).toHaveBeenCalledOnce());
  const signal = mocks.read.mock.calls[0]![2] as AbortSignal;
  view.rerender(<AidtRunContextReceipt {...props} projectId="b" />); expect(signal.aborted).toBe(true);
  view.rerender(<AidtRunContextReceipt {...props} />);
  await act(async () => finish(receipt("message-dispatch-observed")));
  expect(screen.queryByText(/派发或续跑回执不代表/)).toBeNull(); expect(mocks.read).toHaveBeenCalledOnce();
});
it("uses stable task values rather than restarting reads on an equivalent props object", async () => {
  const view = render(<AidtRunContextReceipt {...props} />); expand(); await screen.findByText("第 1 步 · V2");
  view.rerender(<AidtRunContextReceipt {...props} expected={{ purpose: "stage", stageId: 1 }} />); expect(mocks.read).toHaveBeenCalledOnce();
});
it("stops a hung receipt read and lets the student retry without starting a run", async () => {
  vi.useFakeTimers(); mocks.read.mockReturnValueOnce(new Promise(() => {}));
  render(<AidtRunContextReceipt {...props} />); expand();
  const signal = mocks.read.mock.calls[0]![2] as AbortSignal;
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(signal.aborted).toBe(true); expect(screen.getByRole("alert")).toHaveTextContent("当前状态尚未确认");
  expect(screen.getByRole("button", { name: "刷新回执" })).toBeEnabled();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "刷新回执" })); });
  expect(screen.getByText("第 1 步 · V2")).toBeVisible(); expect(mocks.read).toHaveBeenCalledTimes(2);
});
