import * as React from "react";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * issue #3311 —— 人类实测：提醒面板里点一条通知，**什么都没弹出来，被点的那条直接消失了**。
 *
 * 三条判据，每条都必须能因为「点击 = 读掉并丢弃」这个缺陷形状而变红：
 *
 * ① 有对话可去的通知：点击必须**把用户带走**——路由真的落到
 *    `workbenchThreadPath(threadId)`，**并且弹层关闭**。弹层不关，用户看到的
 *    就只有"那一行凭空消失"（老断言只判 `onOpenThread` 被调用过，
 *    在这个缺陷下无法被证伪：它今天也是被调用的）。
 * ② 邮件和系统通知打开正文详情，已读记录也可以重新打开。
 * ③ 「等待你授权工具 / 等待你确认计划」这类**待办**通知与「已完成」这类**收据**，
 *    点击语义必须不同：待办不许因为"看了一眼"就被消费掉——事情还没办。
 *    今天两者走同一行 `onClick`，本断言因此变红。
 */
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ apiRequest: request }));
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  usePathname: () => "/chat",
  useRouter: () => ({ push, replace: () => {}, refresh: () => {}, prefetch: () => {}, back: () => {}, forward: () => {} }),
}));
const sessionValue = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => sessionValue.current }));

import type { Notification } from "@repo/contracts/notifications";
import { InboxScreen } from "@/components/inbox/inbox-screen";
import { RailNotifications } from "@/components/shell/rail-notifications";
import { workbenchThreadPath } from "@/lib/chat-workbench/project-scope";

const notice = (id: string, kind: "task" | "email", title: string, threadId: string | null) => ({
  id: `00000000-0000-4000-8000-00000000000${id}`, kind, title, body: "",
  threadId, actionable: title.includes("等待"), createdAt: "2026-09-10T00:00:00.000Z", readAt: null,
});
const readCalls = () => request.mock.calls.filter((call) => call[0] === "/notifications/read");
function serve(notifications: Notification[]) {
  request.mockImplementation(async (path: string, opts?: { method?: string }) => {
    if (path === "/notifications") return { notifications, unreadCount: notifications.length };
    if (path === "/notifications/read" && opts?.method === "POST") return { read: 1 };
    if (String(path).startsWith("/schedule-notifications")) return { notifications: [] };
    throw new Error(`unexpected ${String(path)}`);
  });
}
const trigger = () => screen.getByTestId("task-notifications-trigger");
const popover = () => screen.queryByTestId("task-notifications-popover");
async function openPanel(notifications: Notification[]) {
  serve(notifications);
  render(<RailNotifications />);
  await waitFor(() => expect(trigger()).toBeInTheDocument());
  fireEvent.click(trigger());
  return within(await screen.findByTestId("task-notifications-popover"));
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  request.mockReset(); push.mockReset();
  sessionValue.current = { session: { sessionToken: "token" } };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("#3311 点一条通知，用户必须知道自己被带到哪儿了", () => {
  it("① 有对话可去：路由落到该对话，且弹层关闭（不是那行凭空消失）", async () => {
    const panel = await openPanel([notice("1", "task", "你好 · 已完成", "thread-7")]);
    fireEvent.click(panel.getByTestId("notification-item"));
    // 到达：路由目标由 `workbenchThreadPath` 这一个事实源给出，不在断言里另抄一份字符串。
    expect(push).toHaveBeenCalledWith(workbenchThreadPath("thread-7", null));
    // 可见：弹层让位，否则用户面前只剩"少了一行"的面板。
    await waitFor(() => expect(popover()).toBeNull());
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
  });

  it("opens an unread mail receipt and exposes its stored body", async () => {
    const panel = await openPanel([{ ...notice("2", "email", "邮件：重置密码", null), body: "邮件已发送，请检查邮箱。" }]);
    fireEvent.click(within(panel.getByTestId("notification-item")).getByRole("button", { name: /重置密码/ }));
    expect(push).toHaveBeenCalledWith("/inbox?message=00000000-0000-4000-8000-000000000002");
    render(<InboxScreen initialMessage="00000000-0000-4000-8000-000000000002" />);
    const detail = await screen.findByRole("region", { name: "消息详情" });
    expect(await within(detail).findByText("邮件已发送，请检查邮箱。")).toBeVisible();
    await waitFor(() => expect(readCalls()).toHaveLength(1));
  });

  it("opens a read invitation with a recipient confirmation link", async () => {
    const inviteId = "oi-" + "a".repeat(24);
    const panel = await openPanel([{
      ...notice("5", "email", "组织邀请", null),
      readAt: "2026-09-10T00:00:00.000Z",
      inboxInviteId: inviteId,
    }]);
    fireEvent.click(panel.getByText("最近已读"));
    fireEvent.click(panel.getByRole("button", { name: /组织邀请/ }));
    render(<InboxScreen initialMessage="00000000-0000-4000-8000-000000000005" />);
    expect(await screen.findByRole("link", { name: "查看邀请" })).toHaveAttribute("href", `/auth/activate?invite=${inviteId}`);
    expect(readCalls()).toHaveLength(0);
  });

  it("③ 待办通知（等待你授权工具）点开只是去办，不许当场被消费掉", async () => {
    const panel = await openPanel([
      notice("3", "task", "你好 · 等待你授权工具", "thread-7"),
      notice("4", "task", "你好 · 已完成", "thread-8"),
    ]);
    const [todo, receipt] = panel.getAllByTestId("notification-item");
    fireEvent.click(todo!);
    // 去办：路由到那条对话（对话页的还原审批卡就在那儿）。
    expect(push).toHaveBeenCalledWith(workbenchThreadPath("thread-7", null));
    // 事情还没办完，这条待办不许被"看一眼"读掉——否则用户回头找不到该去哪授权。
    await waitFor(() => expect(popover()).toBeNull());
    expect(readCalls()).toHaveLength(0);
    // 对照组：纯收据点了就该读掉，两者语义确实不同（不是把两边都改成不读）。
    fireEvent.click(trigger());
    fireEvent.click(within(await screen.findByTestId("task-notifications-popover")).getAllByTestId("notification-item")[1] ?? receipt!);
    await waitFor(() => expect(readCalls()).toHaveLength(1));
    expect(readCalls()[0]![1]).toMatchObject({ body: { ids: ["00000000-0000-4000-8000-000000000004"] } });
  });
});

it("changes the reading pane when a different message is selected", async () => {
  serve([
    { ...notice("1", "email", "第一封", null), body: "第一封正文" },
    { ...notice("2", "task", "第二封", "thread-8"), body: "第二封正文" },
  ]);
  render(<InboxScreen />);
  const list = await screen.findByRole("navigation", { name: "站内信" });
  const pane = screen.getByRole("region", { name: "消息详情", hidden: true });
  fireEvent.click(await within(list).findByRole("button", { name: /第一封/ }));
  expect(within(pane).getByText("第一封正文")).toBeVisible();
  fireEvent.click(within(list).getByRole("button", { name: /第二封/ }));
  expect(within(pane).queryByText("第一封正文")).toBeNull();
  expect(within(pane).getByText("第二封正文")).toBeVisible();
  expect(within(pane).getByRole("link", { name: "打开对话" })).toHaveAttribute("href", workbenchThreadPath("thread-8", null));
});
