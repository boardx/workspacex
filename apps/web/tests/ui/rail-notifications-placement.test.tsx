import * as React from "react";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * issue #3246 —— 通知铃铛从**会话列表栏顶部**搬到**最左侧图标导航栏**。
 *
 * 判据全是**结构事实**（trigger 在哪个容器里、弹层归谁所有、条目数、开合状态、
 * 无障碍名），不是「元素存在」、不是截图字节比对（本仓 C2 反面教材）。
 * 几何事实（弹层向右展开、不出视口）在真浏览器里量，见
 * `e2e/chat-rail-notifications-geometry.spec.ts`——jsdom 没有布局引擎。
 *
 * 两个方向都有会红的断言：
 *   · 该在新位置：`task-notifications-trigger` 必须落在 `rail-bottom` 子树里；
 *   · 不该在老位置：聊天外壳的会话列表栏源码里不得再挂 `TaskNotifications`。
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

import { IconRail } from "@/components/shell/icon-rail";
import { MOCK_ORGS, mockIdentity } from "@/lib/identity";
import { FeedbackProvider } from "@/components/feedback/feedback-provider";

const notice = (id: string, title: string, threadId: string | null) => ({
  id: `00000000-0000-4000-8000-00000000000${id}`, kind: "task" as const,
  title, body: "", threadId, createdAt: "2026-09-10T00:00:00.000Z", readAt: null,
});
function serve(notifications: ReturnType<typeof notice>[], unreadCount = notifications.length) {
  request.mockImplementation(async (path: string, opts?: { method?: string }) => {
    if (path === "/notifications") return { notifications, unreadCount };
    if (path === "/notifications/read" && opts?.method === "POST") return { read: notifications.length };
    if (String(path).startsWith("/schedule-notifications")) return { notifications: [] };
    throw new Error(`unexpected ${String(path)}`);
  });
}
function renderRail() {
  return render(
    <FeedbackProvider>
    <IconRail
      identity={mockIdentity("org-yuanyang", null)}
      organizations={MOCK_ORGS.map((o) => ({ id: o.id, label: o.name }))}
      onSwitchOrganization={() => {}}
      avatarInitial="U"
    />
    </FeedbackProvider>,
  );
}
const trigger = () => screen.getByTestId("task-notifications-trigger");

beforeEach(() => {
  request.mockReset(); push.mockReset();
  sessionValue.current = { session: { sessionToken: "token" } };
});
afterEach(() => cleanup());

describe("#3246 铃铛在图标导航栏里", () => {
  it("trigger 落在 rail-bottom 里、在反馈按钮之前，且不在中段滚动区（不会随目的地列表滚走）", async () => {
    serve([notice("1", "Report · 已完成", "thread-1")]);
    renderRail();
    await waitFor(() => expect(trigger()).toBeInTheDocument());

    const rail = screen.getByTestId("shell-rail");
    const bottom = screen.getByTestId("rail-bottom");
    const scroll = screen.getByTestId("rail-scroll");
    expect(rail.contains(trigger())).toBe(true);
    expect(bottom.contains(trigger())).toBe(true);
    // 不在中段：中段会随目的地列表滚动，而未读提醒要随时可达。
    expect(scroll.contains(trigger())).toBe(false);
    // 与目的地项之间有分隔（钉底部那一段自己带上边框）。
    expect(bottom.className).toContain("border-t");
    // 顺序：铃铛在反馈按钮之前（DOM 顺序 = Tab 顺序）。
    expect(trigger().compareDocumentPosition(screen.getByTestId("rail-feedback")))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // 它是一个动作而不是目的地：不许拿到导航项的 aria-current 高亮语义。
    expect(trigger().getAttribute("aria-current")).toBeNull();
  });

  it("沿用导航项的「图标 + 中文标签」体例，且未读为 0 时图标仍在、只是不显角标", async () => {
    serve([], 0);
    renderRail();
    await waitFor(() => expect(trigger()).toHaveAccessibleName("任务提醒，0 条未读"));
    expect(trigger()).toHaveTextContent("提醒");
    // 入口稳定：0 未读时按钮仍在 DOM 里，只有角标消失。
    expect(screen.queryByTestId("task-notifications-badge")).toBeNull();

    cleanup();
    serve([notice("1", "Report · 已完成", "t"), notice("2", "另一件事 · 已完成", null)]);
    renderRail();
    await waitFor(() => expect(screen.getByTestId("task-notifications-badge")).toHaveTextContent("2"));
    // 角标是图形：真实计数只走 trigger 的 aria-label，读屏不读两遍（#3226 原有纪律）。
    expect(screen.getByTestId("task-notifications-badge")).toHaveAttribute("aria-hidden", "true");
    expect(trigger()).toHaveAccessibleName("任务提醒，2 条未读");
  });

  it("三件功能都在新位置可达：未读计数 / 全部标为已读 / 最近已读；a11y 契约随之搬过来", async () => {
    serve([notice("1", "Report · 已完成", "thread-1"), notice("2", "另一件事 · 已完成", null)]);
    renderRail();
    await waitFor(() => expect(trigger()).toHaveAttribute("aria-expanded", "false"));
    expect(trigger()).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger().getAttribute("aria-controls")).toBeNull();
    // 收起态：整个组件子树里一条通知正文都没有（结构事实，不是"看不见"）。
    expect(within(screen.getByTestId("task-notifications")).queryAllByTestId("notification-item")).toHaveLength(0);

    fireEvent.click(trigger());
    const popover = await screen.findByTestId("task-notifications-popover");
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(trigger()).toHaveAttribute("aria-controls", "task-notifications-popover");
    // 弹层归这个 trigger 所有：同一个 `task-notifications` 子树，不是飘在别处的孤儿层。
    expect(screen.getByTestId("task-notifications").contains(popover)).toBe(true);
    expect(within(popover).getAllByTestId("notification-item")).toHaveLength(2);
    expect(within(popover).getByText("全部标为已读")).toBeInTheDocument();

    // 点条目 → 跳那个对话（老位置用外壳软导航，图标栏是全局的，只能路由跳）。
    fireEvent.click(within(popover).getAllByTestId("notification-item")[0]!);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/chat/thread-1"));

    // Esc 关闭并把焦点还给 trigger（TW-A11Y-5，#3226 已有，搬位置后仍成立）。
    // 点条目只做「标已读 + 跳转」，不关弹层——所以这里直接对着还开着的那一个按 Esc。
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(popover, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("task-notifications-popover")).toBeNull());
    expect(document.activeElement).toBe(trigger());
  });

  it("没有会话时不渲染铃铛（不留一个点了必然 401 的入口）", async () => {
    sessionValue.current = null;
    renderRail();
    expect(screen.queryByTestId("task-notifications-trigger")).toBeNull();
    // 阳性对照：同一棵树在有会话时确实渲染得出来（见上面三条），这条不是"本来就没渲染"。
    expect(screen.getByTestId("rail-bottom")).toBeInTheDocument();
  });
});

describe("#3246 老位置确实空了", () => {
  it("聊天外壳的会话列表栏不再挂 TaskNotifications，但对话列表保鲜留在外壳", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const shell = readFileSync(path.join(process.cwd(), "components/chat/copilotkit-v2-shell.tsx"), "utf8");
    expect(shell).not.toContain("<TaskNotifications");
    expect(shell).not.toContain('from "@/components/chat/workbench/task-notifications"');
    // 铃铛顺带承担的 10s / 回焦刷新不许跟着搬走——否则对话列表从此不再自动刷新，
    // 而没有任何断言会红。
    expect(shell).toContain("useIntervalFocusRefresh(reloadThreads)");
    const railSrc = readFileSync(path.join(process.cwd(), "components/shell/rail-notifications.tsx"), "utf8");
    expect(railSrc).toContain('variant="rail"');
  });
});
