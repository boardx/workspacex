import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useChatRunAnnouncements, selectAnnouncementRun, type ChatRunAnnouncementInput } from "@/components/chat/use-chat-run-announcements";
import { announceToChat } from "@/components/chat/chat-live-announcer";
vi.mock("@/components/chat/chat-live-announcer", () => ({ announceToChat: vi.fn() }));
const base: ChatRunAnnouncementInput = { scope: "org/user/thread", busy: false, waiting: false, paused: false,
  hasError: false, runId: null, terminalStatus: null, terminalProof: null, locale: "zh-CN" };

it("announces approval and resume while SDK transport is idle; only a new authoritative terminal can finish", () => {
  const { rerender } = renderHook((props: ChatRunAnnouncementInput) => useChatRunAnnouncements(props), { initialProps: base });
  rerender({ ...base, busy: true });
  expect(announceToChat).toHaveBeenLastCalledWith("正在处理你的请求……");
  rerender({ ...base, busy: true, waiting: true });
  expect(announceToChat).toHaveBeenLastCalledWith("等待确认");
  rerender({ ...base, busy: true });
  expect(announceToChat).toHaveBeenLastCalledWith("正在处理你的请求……");
  rerender({ ...base });
  expect(announceToChat).not.toHaveBeenCalledWith("本次处理已结束，请查看任务结果。");
  rerender({ ...base, runId: "run-1", terminalStatus: "succeeded", terminalProof: "run-1:20:succeeded" });
  expect(announceToChat).toHaveBeenLastCalledWith("本次处理已结束，请查看任务结果。");
});

it("does not recycle a historical terminal proof after a new transport stops", () => {
  const prior = { ...base, runId: "old", terminalStatus: "succeeded", terminalProof: "old:20:succeeded" };
  const { rerender } = renderHook((props: ChatRunAnnouncementInput) => useChatRunAnnouncements(props), { initialProps: prior });
  vi.mocked(announceToChat).mockClear();
  rerender({ ...prior, busy: true }); rerender(prior);
  expect(announceToChat).not.toHaveBeenCalledWith("本次处理已结束，请查看任务结果。");
});

it("does not treat delayed hydration of the same historical terminal as new-run evidence", () => {
  const prior = { ...base, runId: "old", terminalStatus: "succeeded", terminalProof: "old:restore:succeeded" };
  const { rerender } = renderHook((props: ChatRunAnnouncementInput) => useChatRunAnnouncements(props), { initialProps: prior });
  vi.mocked(announceToChat).mockClear();
  rerender({ ...prior, busy: true });
  rerender({ ...prior, busy: true, terminalProof: "old:20:succeeded" });
  rerender({ ...prior, terminalProof: "old:20:succeeded" });
  expect(announceToChat).not.toHaveBeenCalledWith("本次处理已结束，请查看任务结果。");
});

it("prefers the latest actual chat run over an old externally observed run", () => {
  const events = {
    old: [{ kind: "status", runId: "old", seq: 20, emittedAt: "2026-11-06T08:00:00Z", status: "succeeded" }],
    current: [{ kind: "status", runId: "current", seq: 1, emittedAt: "2026-11-06T08:01:00Z", status: "running" }],
  } as never;
  expect(selectAnnouncementRun(events, { runId: "old", status: "succeeded" }, "old")).toMatchObject({ runId: "current", status: "running" });
  const terminal = { ...events as object, current: [{ kind: "status", runId: "current", seq: 30, emittedAt: "2026-11-06T08:02:00Z", status: "succeeded" }] } as never;
  expect(selectAnnouncementRun(terminal, { runId: "old", status: "succeeded" }, "old")).toMatchObject({ runId: "current", status: "succeeded" });
});

it("distinguishes pause, cancellation and failure, and clears the old thread announcement", () => {
  const { rerender } = renderHook((props: ChatRunAnnouncementInput) => useChatRunAnnouncements(props), { initialProps: base });
  rerender({ ...base, busy: true, paused: true });
  expect(announceToChat).toHaveBeenLastCalledWith("任务已暂停");
  rerender({ ...base, runId: "run", terminalStatus: "cancelled", terminalProof: "run:22:cancelled" });
  expect(announceToChat).toHaveBeenLastCalledWith("任务已停止。");
  rerender({ ...base, busy: true });
  rerender({ ...base, runId: "run2", terminalStatus: "failed", terminalProof: "run2:10:failed" });
  expect(announceToChat).toHaveBeenLastCalledWith("这次任务执行失败，请查看错误说明。");
  rerender({ ...base, scope: "org/user/another-thread" });
  expect(announceToChat).toHaveBeenLastCalledWith("");
});

it("retranslates the current state while keeping a settled terminal and without reviving history", () => {
  const { rerender } = renderHook((props: ChatRunAnnouncementInput) => useChatRunAnnouncements(props), { initialProps: base });
  rerender({ ...base, busy: true, waiting: true, locale: "en" });
  expect(announceToChat).toHaveBeenLastCalledWith("Awaiting confirmation");
  rerender({ ...base, runId: "current", terminalStatus: "succeeded", terminalProof: "current:30:succeeded", locale: "en" });
  expect(announceToChat).toHaveBeenLastCalledWith("Processing finished. Check the task results.");
  rerender({ ...base, runId: "current", terminalStatus: "succeeded", terminalProof: "current:30:succeeded" });
  expect(announceToChat).toHaveBeenLastCalledWith("本次处理已结束，请查看任务结果。");
});
