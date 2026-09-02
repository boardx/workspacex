import { test, expect, type Page } from "@playwright/test";

/**
 * #2512 —— IconRail 短视口策略（PR #2513，rev-feature 复核要求的真实浏览器证据）。
 *
 * 目标页 `/kitchen-sink`：`AppShell` 包裹、mock identity、不读 DB、不需要登录态
 * （同 `axe-keyboard-focus.spec.ts` 的理由）。左侧 rail 就是生产同一份 `IconRail`。
 *
 * 四档高度 380 / 500 / 640 / 900 逐一断言：
 *   1. 页面本身与 nav 都不滚动，只有中段 `rail-scroll` 滚动；
 *   2. 头像（个人菜单触发器）与顶部组织菜单始终在视口内；
 *   3. 每一个一级入口都可达（滚到它就在视口内）；
 *   4. 键盘 Tab / Shift+Tab 走遍入口：焦点元素自动滚入视口、有可见焦点环（浅色 + 深色）；
 *      Enter 真的导航；
 *   5. 紧凑模式（≤ 640）：文字隐藏、键盘 focus 弹出 tooltip；高视口：文字可见；
 *   6. 底部个人菜单在最矮视口也能打开且弹层在视口内。
 * 最后一条是反证：把中段的 overflow 撤掉，头像就掉出视口——证明上面的断言不是空转。
 */
const WIDTH = 1200;
const HEIGHTS = [380, 500, 640, 900] as const;
const COMPACT_MAX = 640;

async function gotoRail(page: Page, height: number) {
  await page.setViewportSize({ width: WIDTH, height });
  await page.goto("/kitchen-sink");
  await expect(page.getByTestId("shell-rail")).toBeVisible();
}

function inViewport(box: { x: number; y: number; width: number; height: number } | null, height: number) {
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(height + 0.5);
}

async function hasFocusRing(page: Page, testid: string) {
  return page.getByTestId(testid).evaluate((el) => {
    const s = getComputedStyle(el);
    return s.boxShadow !== "none" || (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0);
  });
}

test.describe("IconRail 短视口三段布局", () => {
  for (const height of HEIGHTS) {
    test(`高度 ${height}px：只有中段滚动，头像/组织菜单固定可见，每个入口可达`, async ({ page }) => {
      await gotoRail(page, height);

      // 1. 页面与 nav 自身不滚动
      const overflow = await page.evaluate(() => ({
        doc: document.scrollingElement!.scrollHeight - document.scrollingElement!.clientHeight,
        nav: (() => {
          const n = document.querySelector('[data-testid="shell-rail"]')!;
          return n.scrollHeight - n.clientHeight;
        })(),
      }));
      expect(overflow.doc).toBeLessThanOrEqual(1);
      expect(overflow.nav).toBeLessThanOrEqual(1);

      // 2. 顶部组织菜单 + 底部头像在视口内
      inViewport(await page.getByTestId("org-switcher").boundingBox(), height);
      inViewport(await page.getByTestId("rail-profile-menu").boundingBox(), height);

      // 3. 每个一级入口滚到即可见，且滚动只发生在 rail-scroll
      const scroll = page.getByTestId("rail-scroll");
      const links = page.locator('[data-testid="rail-scroll"] a[data-testid^="rail-"]');
      const count = await links.count();
      expect(count).toBeGreaterThanOrEqual(8);
      for (let i = 0; i < count; i++) {
        await links.nth(i).scrollIntoViewIfNeeded();
        await expect(links.nth(i)).toBeInViewport();
      }
      const scrolled = await page.evaluate(() => ({
        win: window.scrollY,
        nav: document.querySelector('[data-testid="shell-rail"]')!.scrollTop,
      }));
      expect(scrolled.win).toBe(0);
      expect(scrolled.nav).toBe(0);
      // 头像滚完仍在视口内
      inViewport(await page.getByTestId("rail-profile-menu").boundingBox(), height);
      // 高度不够时中段真的在滚（反过来，高度够时不该有滚动量）
      const zone = await scroll.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
      if (height <= 400) expect(zone.sh).toBeGreaterThan(zone.ch);
      if (height >= 900) expect(zone.sh).toBeLessThanOrEqual(zone.ch + 1);
    });

    test(`高度 ${height}px：键盘 Tab / Shift+Tab 走遍入口，焦点可见且自动滚入视口，Enter 导航`, async ({ page }) => {
      await gotoRail(page, height);
      const links = page.locator('[data-testid="rail-scroll"] a[data-testid^="rail-"]');
      const ids = await links.evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!));
      const first = ids[0];
      const last = ids[ids.length - 1];
      if (!first || !last) throw new Error("rail 没有一级入口");

      // 从第一个入口起 Tab 到最后一个
      await page.getByTestId(first).focus();
      for (const [i, id] of ids.entries()) {
        if (i > 0) await page.keyboard.press("Tab");
        await expect(page.getByTestId(id)).toBeFocused();
        await expect(page.getByTestId(id)).toBeInViewport();
        expect(await hasFocusRing(page, id), `${id} 缺焦点环（浅色）`).toBe(true);
      }
      // Shift+Tab 回到第一个
      for (const id of ids.slice(0, -1).reverse()) {
        await page.keyboard.press("Shift+Tab");
        await expect(page.getByTestId(id)).toBeFocused();
        await expect(page.getByTestId(id)).toBeInViewport();
      }
      // 头像仍固定可见
      inViewport(await page.getByTestId("rail-profile-menu").boundingBox(), height);

      // 深色主题下焦点环同样可见
      await page.evaluate(() => document.documentElement.classList.add("dark"));
      await page.getByTestId(last).focus();
      expect(await hasFocusRing(page, last), "缺焦点环（深色）").toBe(true);
      await page.evaluate(() => document.documentElement.classList.remove("dark"));

      // Enter 真的导航
      const target = page.getByTestId("rail-projects");
      const href = await target.getAttribute("href");
      if (!href) throw new Error("rail-projects 没有 href");
      await target.focus();
      await page.keyboard.press("Enter");
      await page.waitForURL((u) => u.pathname === href, { timeout: 30_000 });
    });

    test(`高度 ${height}px：${height <= COMPACT_MAX ? "紧凑模式——文字隐藏、focus 弹 tooltip" : "常规模式——文字可见、无 tooltip"}`, async ({ page }) => {
      await gotoRail(page, height);
      const chat = page.getByTestId("rail-chat");
      const label = chat.locator("span");
      await chat.focus();
      if (height <= COMPACT_MAX) {
        await expect(label).toBeHidden();
        await expect(chat).toHaveAttribute("aria-label", "对话");
        await expect(page.getByTestId("rail-tooltip-chat")).toBeVisible();
        await expect(page.getByTestId("rail-tooltip-chat")).toHaveText("对话");
      } else {
        await expect(label).toBeVisible();
        await expect(label).toHaveText("对话");
        await expect(page.getByTestId("rail-tooltip-chat")).toBeHidden();
      }
    });
  }

  test("最矮视口 380px：底部个人菜单能打开，弹层整个在视口内", async ({ page }) => {
    await gotoRail(page, 380);
    await page.getByTestId("rail-profile-menu").dispatchEvent("pointerdown", { button: 0 });
    const menu = page.getByTestId("rail-personal-menu");
    await expect(menu).toBeVisible();
    inViewport(await menu.boundingBox(), 380);
    await expect(page.getByTestId("personal-menu-profile")).toBeVisible();
  });

  test("反证：还原修复前布局（中段不滚动 + 文字不隐藏）后头像掉出 380px 视口——断言不是空转", async ({ page }) => {
    await gotoRail(page, 380);
    inViewport(await page.getByTestId("rail-profile-menu").boundingBox(), 380);
    await page.addStyleTag({
      content: [
        '[data-testid="rail-scroll"]{overflow:visible!important;flex:none!important;min-height:auto!important}',
        '[data-testid="rail-scroll"] span{display:inline!important}',
      ].join("\n"),
    });
    const box = await page.getByTestId("rail-profile-menu").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeGreaterThan(380);
  });
});
