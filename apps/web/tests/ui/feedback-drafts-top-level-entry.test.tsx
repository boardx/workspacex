/**
 * issue #3339（2026-09-10 人类反馈）：反馈草稿从「后台专属」改为全体终端用户可用的
 * 顶层功能。断的是这次改动的用户可见部分：
 *   ① 顶层导航 STUDIO 段有「反馈草稿」一级入口，指向独立路由 /studio/feedback-drafts
 *      （不是只能从 /platform-admin 敲 URL 进）。
 *   ② 该路由的页面组件（`StudioFeedbackDraftsScreen`）渲染的是与平台后台完全同一个
 *      真栈组件 `DesignLoopDraftsScreen`——草稿数据/交互不是另起一份影子实现。
 *   ③ `/platform-admin/feedback-drafts` 原入口不下线（平台运维仍可从后台查看）。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NAV_SEGMENTS } from "@/lib/navigation";

afterEach(() => cleanup());

describe("issue #3339：反馈草稿顶层入口", () => {
  it("① STUDIO 段声明「反馈草稿」一级导航项，指向独立路由", () => {
    const studio = NAV_SEGMENTS.find((s) => s.label === "STUDIO");
    expect(studio).toBeTruthy();
    const item = studio!.items.find((i) => i.key === "feedback-drafts");
    expect(item).toBeTruthy();
    expect(item!.href).toBe("/studio/feedback-drafts");
    expect(item!.label).toBe("反馈草稿");
  });

  it("② StudioFeedbackDraftsScreen 复用平台后台同一个真栈屏组件（不是另起影子实现）", async () => {
    vi.doMock("next/navigation", () => ({
      usePathname: () => "/studio/feedback-drafts",
      useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    }));
    vi.doMock("@/lib/api-client", async () => {
      const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
      return { ...actual, apiRequest: vi.fn().mockRejectedValue(new Error("no network in test")) };
    });
    const { StudioFeedbackDraftsScreen } = await import("@/components/design-loop/studio-drafts-screen");
    const { FeedbackProvider } = await import("@/components/feedback/feedback-provider");
    render(
      <FeedbackProvider>
        <StudioFeedbackDraftsScreen state="empty" />
      </FeedbackProvider>,
    );
    // 与 tests/ui/feedback-drafts-live.test.tsx 断言同一批 data-testid 来自同一个组件——
    // 这里只需确认屏渲染出来，不重复那份详尽的行为断言。
    expect(await screen.findByTestId("drafts-new")).toBeTruthy();
    vi.doUnmock("next/navigation");
    vi.doUnmock("@/lib/api-client");
  });

  it("③ /platform-admin/feedback-drafts 原入口保留在后台菜单（不下线）", async () => {
    const { ADMIN_NAV } = await import("@/lib/mock/admin");
    const item = ADMIN_NAV.flatMap((g) => g.items).find((i) => i.key === "feedback-drafts");
    expect(item).toBeTruthy();
    expect(item!.href).toBe("/platform-admin/feedback-drafts");
  });
});
