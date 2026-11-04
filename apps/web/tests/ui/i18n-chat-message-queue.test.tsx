import * as React from "react";
import { expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { QueuedMessagesPanel } from "@/components/chat/workbench/queued-messages-panel";
import { QueueNextTurnAction } from "@/components/chat/workbench/queue-next-turn-action";
import type { QueuedMessage } from "@repo/contracts/thread-message-queue";
const queued: QueuedMessage = {
  id: "10000000-0000-4000-8000-000000000001", clientRequestId: "20000000-0000-4000-8000-000000000001",
  text: "用户排队原文 {count} 🌍", agentId: "agent-raw", status: "pending", runId: null, createdAt: "2026-11-04T00:00:00Z", error: null,
};
function SwitchLanguage() { const { setLocale } = useI18n(); return <button onClick={() => setLocale("zh-CN")}>switch language</button>; }
it("keeps a queued edit and in-flight save bound to its real row across locale changes", async () => {
  let resolveSave: (ok: boolean) => void = () => { throw new Error("save not started"); };
  const edit = vi.fn(() => new Promise<boolean>(resolve => { resolveSave = resolve; })); const cancel = vi.fn(async () => {});
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><QueuedMessagesPanel items={[queued]} edit={edit} cancel={cancel} cancelling={null} error={null} canWrite /></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const field = screen.getByRole("textbox", { name: "Edit queued message" });
  const draft = " 新草稿 {status} / English 🌍 "; fireEvent.change(field, { target: { value: draft } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(edit).toHaveBeenCalledWith(queued.id, draft.trim()); expect(field.hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByRole("textbox", { name: "编辑排队中的消息" })).toBe(field);
  expect((field as HTMLTextAreaElement).value).toBe(draft);
  expect(edit).toHaveBeenCalledTimes(1); expect(cancel).not.toHaveBeenCalled();
  await act(async () => resolveSave(false));
  await waitFor(() => expect(field.hasAttribute("disabled")).toBe(false));
  expect((field as HTMLTextAreaElement).value).toBe(draft);
});
it("preserves read-only controls, raw failure text and dispatched filtering", () => {
  const cancel = vi.fn(async () => {}); const edit = vi.fn(async () => true);
  const failed: QueuedMessage = { ...queued, id: "10000000-0000-4000-8000-000000000002", status: "failed", text: "失败原文 🌍", error: "raw upstream {count}" };
  const dispatched: QueuedMessage = { ...queued, id: "10000000-0000-4000-8000-000000000003", status: "dispatched", text: "不可冒称完成的已派发内容" };
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><QueuedMessagesPanel items={[queued, failed, dispatched]} edit={edit} cancel={cancel} cancelling={null} error={null} canWrite={false} /></I18nProvider>);
  const withdraw = screen.getByRole("button", { name: "Withdraw" }); expect(withdraw.hasAttribute("disabled")).toBe(true);
  expect(screen.getByText("Could not send: raw upstream {count}")).toBeTruthy();
  expect(screen.queryByText(dispatched.text)).toBeNull();
  fireEvent.click(withdraw); fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByRole("button", { name: "撤回" })).toBe(withdraw); expect(withdraw.hasAttribute("disabled")).toBe(true);
  expect(cancel).not.toHaveBeenCalled(); expect(edit).not.toHaveBeenCalled();
});
it("localizes the next-turn action without dispatching anything on locale change", () => {
  const queue = vi.fn();
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><QueueNextTurnAction visible disabled={false} onQueue={queue} /></I18nProvider>);
  const action = screen.getByRole("button", { name: "Queue for next turn" });
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByRole("button", { name: "排到下一轮" })).toBe(action); expect(queue).not.toHaveBeenCalled();
  fireEvent.click(action); expect(queue).toHaveBeenCalledTimes(1);
});
