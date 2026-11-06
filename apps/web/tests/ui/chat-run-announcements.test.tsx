import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useChatRunAnnouncements, type ChatRunAnnouncementInput } from "@/components/chat/use-chat-run-announcements";
import { announceToChat } from "@/components/chat/chat-live-announcer";
vi.mock("@/components/chat/chat-live-announcer", () => ({ announceToChat: vi.fn() }));
const base: ChatRunAnnouncementInput = { scope: "org/user/thread", busy: false, waiting: false, hasError: false,
  live: { generation: 0, event: null }, restored: { runId: null, status: null }, locale: "zh-CN" };
function live(runId: string, status: NonNullable<ChatRunAnnouncementInput["live"]["event"]>["status"], seq: number, generation = 1) {
  return { generation, event: { kind: "status" as const, runId, status, seq, emittedAt: "2026-11-06T08:00:00Z" } };
}
const done = "本次处理已结束，请查看任务结果。";
it("uses real approval/resume/terminal state instead of treating SDK transport stop as completion", () => {
  const { rerender } = renderHook((props: ChatRunAnnouncementInput) => useChatRunAnnouncements(props), { initialProps: base });
  rerender({ ...base, busy: true, live: live("run", "running", 1) });
  expect(announceToChat).toHaveBeenLastCalledWith("正在处理你的请求……");
  rerender({ ...base, busy: true, waiting: true, live: live("run", "awaiting_tool_permission", 2) });
  expect(announceToChat).toHaveBeenLastCalledWith("等待确认");
  rerender({ ...base, busy: true, live: live("run", "running", 3) });
  expect(announceToChat).toHaveBeenLastCalledWith("正在处理你的请求……");
  rerender({ ...base, live: live("run", "succeeded", 4) }); expect(announceToChat).toHaveBeenLastCalledWith(done);
});
it("does not announce a historical terminal at mount, unknown activity end or unchanged live evidence", () => {
  const old: ChatRunAnnouncementInput = { ...base, live: live("old", "succeeded", 20) };
  const { rerender } = renderHook((props: ChatRunAnnouncementInput) => useChatRunAnnouncements(props), { initialProps: old });
  vi.mocked(announceToChat).mockClear();
  rerender({ ...old, busy: true }); rerender(old);
  expect(announceToChat).not.toHaveBeenCalledWith(done);
  rerender({ ...base, busy: true, live: { generation: 2, event: null } }); rerender({ ...base, live: { generation: 2, event: null } });
  expect(announceToChat).not.toHaveBeenCalledWith(done);
});
it("retained live A cannot settle restored B after B cancels or restoration becomes unknown", () => {
  const a = live("A", "succeeded", 20);
  const { rerender } = renderHook((props: ChatRunAnnouncementInput) => useChatRunAnnouncements(props), { initialProps: base });
  rerender({ ...base, live: a }); expect(announceToChat).toHaveBeenLastCalledWith(done);
  vi.mocked(announceToChat).mockClear();
  rerender({ ...base, live: a, busy: true, restored: { runId: "B", status: "running" } });
  rerender({ ...base, live: a });
  expect(announceToChat).not.toHaveBeenCalledWith(done); expect(announceToChat).toHaveBeenLastCalledWith("");
});
it("handles batched stream start and first terminal without replaying that terminal in another generation", () => {
  const { rerender } = renderHook((props: ChatRunAnnouncementInput) => useChatRunAnnouncements(props), { initialProps: base });
  rerender({ ...base, live: live("fast", "succeeded", 5) }); expect(announceToChat).toHaveBeenLastCalledWith(done);
  vi.mocked(announceToChat).mockClear();
  rerender({ ...base, busy: true, live: { generation: 2, event: null } });
  rerender({ ...base, live: live("fast", "succeeded", 5, 2) });
  expect(announceToChat).not.toHaveBeenCalledWith(done);
  rerender({ ...base, live: live("next", "succeeded", 10, 3) }); expect(announceToChat).toHaveBeenLastCalledWith(done);
});
it("distinguishes pause/cancel/failure, preserves locale state and clears scope changes", () => {
  const { rerender } = renderHook((props: ChatRunAnnouncementInput) => useChatRunAnnouncements(props), { initialProps: base });
  rerender({ ...base, busy: true, live: live("run", "paused", 1) }); expect(announceToChat).toHaveBeenLastCalledWith("任务已暂停");
  rerender({ ...base, live: live("run", "cancelled", 2) }); expect(announceToChat).toHaveBeenLastCalledWith("任务已停止。");
  rerender({ ...base, live: live("run2", "failed", 3, 2) }); expect(announceToChat).toHaveBeenLastCalledWith("这次任务执行失败，请查看错误说明。");
  rerender({ ...base, live: live("run2", "failed", 3, 2), locale: "en" }); expect(announceToChat).toHaveBeenLastCalledWith("This task failed. Check the error details.");
  rerender({ ...base, scope: "org/user/another-thread", live: live("run2", "failed", 3, 2) }); expect(announceToChat).toHaveBeenLastCalledWith("");
});
