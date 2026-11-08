import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Notification } from "@repo/contracts/notifications";
import { ScheduleNotification } from "@repo/contracts/schedule-notifications";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { TaskNotifications } from "@/components/chat/workbench/task-notifications";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ apiRequest: request }));
const notices = ["task", "email", "system"].map((kind, index) => Notification.parse({
  id: `00000000-0000-4000-8000-00000000000${index + 1}`, kind, title: `原文 {name} ${kind}`,
  body: "用户正文", threadId: null, actionable: false, createdAt: "2026-11-03T00:00:00Z", readAt: null,
}));
const scheduled = ScheduleNotification.parse({ factId: "00000000-0000-4000-8000-000000000005", scheduleId: "00000000-0000-4000-8000-000000000006", code: "authorization_revoked", acceptedAt: "2026-11-03T00:00:00Z", readAt: null });
function SwitchLanguage() {
  const { setLocale } = useI18n();
  return <button onClick={() => setLocale("zh-CN")}>中文</button>;
}
function show() {
  return render(<I18nProvider initialLocale="en"><SwitchLanguage /><TaskNotifications variant="rail" sessionToken="test-token" onOpenThread={vi.fn()} /></I18nProvider>);
}
beforeEach(() => { request.mockReset(); });
afterEach(cleanup);
it("translates category labels and aria counts while preserving original titles without repeating requests", async () => {
  request.mockImplementation(async (path: string) => path === "/notifications" ? { notifications: notices, unreadCount: 3 } : { notifications: [] });
  show();
  await waitFor(() => expect(screen.getByTestId("task-notifications-trigger")).toHaveAccessibleName("Notifications, 3 unread"));
  expect(screen.getByTestId("task-notifications-trigger").querySelector("svg")).not.toBeNull();
  fireEvent.click(screen.getByTestId("task-notifications-trigger"));
  expect(screen.getByRole("dialog", { name: "Notifications" })).toBeTruthy();
  for (const kind of ["Task", "Email", "System"]) expect(screen.getByText(`[${kind}]`)).toBeTruthy();
  for (const notice of notices) expect(screen.getByText(notice.title)).toBeTruthy();
  const calls = request.mock.calls.length;
  fireEvent.click(screen.getByText("中文"));
  expect(screen.getByTestId("task-notifications-trigger")).toHaveAccessibleName("任务提醒，3 条未读");
  expect(screen.getByText("[任务]")).toBeTruthy();
  for (const notice of notices) expect(screen.getByText(notice.title)).toBeTruthy();
  expect(request.mock.calls.length).toBe(calls);
  expect(request.mock.calls.some(([path]) => path === "/notifications/read")).toBe(false);
});
it("translates scheduled failure codes and sends the unchanged fact ID on explicit acknowledgment", async () => {
  request.mockImplementation(async (path: string) => {
    if (path === "/notifications") return { notifications: [], unreadCount: 0 };
    if (path === "/schedule-notifications/read") return { read: true };
    return { notifications: [scheduled] };
  });
  show();
  await waitFor(() => expect(screen.getByTestId("task-notifications-trigger")).toHaveAccessibleName("Notifications, 1 unread"));
  fireEvent.click(screen.getByTestId("task-notifications-trigger"));
  expect(screen.getByText("Scheduled task stopped: access revoked")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Mark as read" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith("/schedule-notifications/read", expect.objectContaining({ method: "POST", body: { factId: scheduled.factId } })));
  expect(await screen.findByText("No unread notifications")).toBeTruthy();
});
it("translates dependency failures without changing their retry behavior", async () => {
  request.mockRejectedValue(new Error("network"));
  show();
  fireEvent.click(screen.getByTestId("task-notifications-trigger"));
  expect(await screen.findByText("Notifications could not refresh. Retrying automatically.")).toBeTruthy();
  expect(await screen.findByText("Scheduled notifications could not sync. Please try again later.")).toBeTruthy();
});
