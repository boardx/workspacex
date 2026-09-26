/**
 * 迭代 22 —— 发布与分享在**真实浏览器**里的主链路。
 *
 * 为什么必须是真浏览器而不是 jsdom：这条功能的产物是**一条发给别人的链接**，而链接那一端
 * 是一个独立的页面（`/d/<token>`），在手机宽度上被打开。它会不会横向溢出、点得动的跳转
 * 在真实事件下走不走得通，jsdom 一条都答不了。
 */
import { test, expect, type Page } from "@playwright/test";
import { routeDrafts, routeInbox, routeDesignWorkbench } from "../scripts/lib/design-loop-fixtures.mjs";

// 同 `design-loop-responsive.spec.ts` 的 `PW_EXECUTABLE` 约定：本地沙箱的 chromium 版本
// 可能与 @playwright/test 期望的不一致；CI 里不设，走 Playwright 自装的浏览器。
test.use({ launchOptions: process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {} });

const SHARED = {
  name: "对话助手",
  template: "mobile",
  theme: "dark",
  accent: "blue",
  tokens: { brand: null, font: "sans", radius: "default", density: "default" },
  frames: ["聊天", "历史会话"],
  frameNotes: ["首屏即可发消息。", ""],
  frameLinks: [[{ from: "go-history", to: 1 }], []],
  prototype: [
    {
      type: "stack",
      id: "s1",
      children: [
        { type: "navbar", id: "nav1", props: { title: "对话助手" } },
        { type: "text", id: "t1", props: { content: "昨天聊到一半的那条还在。", variant: "body" } },
        { type: "button", id: "go-history", props: { label: "看历史会话", variant: "primary" } },
      ],
    },
    {
      type: "stack",
      id: "s2",
      children: [
        { type: "navbar", id: "nav2", props: { title: "历史会话" } },
        { type: "list", id: "l1", props: { items: ["周报怎么写", "面试提纲"], detail: ["3 条消息", "12 条消息"] } },
      ],
    },
  ],
  publishedAt: "2026-09-22T10:00:00.000Z",
  ownerName: "苏木 · PM",
  problem: null,
  criteria: null,
};

async function routeShare(page: Page, body: unknown = { design: SHARED }, status = 200): Promise<void> {
  await page.route(
    (url) => new URL(url).pathname.startsWith("/public/design-shares/"),
    (route) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }),
  );
}

test.describe("设计者这一侧：发布 → 拿到链接 → 取消发布", () => {
  test("发布后链接就在屏上，取消发布后链接框消失", async ({ page }) => {
    await routeDrafts(page, { empty: false });
    await routeInbox(page, { empty: false });
    await routeDesignWorkbench(page, {});
    await page.goto("/preview/feedback-design-loop?scene=detail-prototype");
    await page.getByTestId("design-detail").waitFor();

    await page.getByTestId("design-detail-share").click();
    const dialog = page.getByTestId("design-share-dialog");
    await expect(dialog).toBeVisible();
    // 发布之前就要能选"带出去多少"——点了才知道发的是什么，那就晚了。
    await expect(page.getByTestId("design-share-scope-prototype")).toBeChecked();
    await expect(page.getByTestId("design-share-url")).toHaveCount(0);

    await page.getByTestId("design-share-publish").click();
    await expect(page.getByTestId("design-share-url")).toHaveValue(/\/d\/.+/);
    await expect(page.getByTestId("design-share-publish")).toContainText("更新发布");

    // 收回是不可逆的（拿到链接的人立刻打不开，而且不会收到通知）——所以要先确认一次。
    await page.getByTestId("design-share-unpublish").click();
    await expect(page.getByTestId("design-share-url")).toHaveCount(1); // 还没确认，链接还在
    await page.getByTestId("design-share-unpublish-yes").click();
    await expect(page.getByTestId("design-share-url")).toHaveCount(0);
    await expect(page.getByTestId("design-share-publish")).toContainText("发布并生成链接");
  });
});

test.describe("访客这一侧：/d/<token>", () => {
  test("打开就能翻页、点得动跳转、按返回回得来", async ({ page }) => {
    await routeShare(page);
    await page.goto("/d/demo-token");
    await expect(page.getByTestId("shared-design-name")).toHaveText("对话助手");
    // 访客要知道自己看的是哪一版——这条链接是一份冻结的快照。
    await expect(page.getByTestId("shared-design-meta")).toContainText("只读");
    await expect(page.getByTestId("shared-design-note")).toContainText("首屏即可发消息");

    // 跳转默认就能点：没有"先切到预览模式"这一步。
    await expect(page.getByTestId("shared-design-back")).toHaveCount(0);
    await page.getByText("看历史会话").click();
    await expect(page.getByTestId("shared-design-frame-1")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("shared-design-back").click();
    await expect(page.getByTestId("shared-design-frame-0")).toHaveAttribute("aria-pressed", "true");
  });

  test("手机宽度（375）不横向溢出——这条链接多半就是在手机上被点开的", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await routeShare(page);
    await page.goto("/d/demo-token");
    await page.getByTestId("shared-design-view").waitFor();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over, `横向溢出 ${String(over)}px`).toBeLessThanOrEqual(0);
  });

  test("链接打不开 ⇒ 一句话说清下一步，不是一片空白", async ({ page }) => {
    await routeShare(page, { reasonCode: "SHARE_NOT_FOUND" }, 404);
    await page.goto("/d/bad-token");
    await expect(page.getByTestId("shared-design-error")).toContainText("要一条新的");
  });
});
