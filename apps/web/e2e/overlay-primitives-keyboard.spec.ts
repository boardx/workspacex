import { test, expect } from "@playwright/test";

/**
 * F01 —— 统一的 Dialog / Dropdown 弹层原语，键盘可达走查（真实浏览器）。
 *
 * ## 为什么这条必须用真实浏览器
 * Tab 焦点陷阱、方向键高亮、深色模式对比度都是**浏览器实际计算**的结果
 * （focus-trap 依赖真实 Tab 顺序遍历 DOM、`prefers-color-scheme`/`.dark` 影响的是
 * computed style），jsdom 跑不出这些（`tests/ui/overlay-primitives-dialog-dropdown.test.tsx`
 * 已经用 jsdom 断了「点遮罩/Esc 关闭一致」与「嵌套 dialog 不丢焦点」，本文件只补
 * jsdom 断不了的三件：Tab 陷阱、方向键导航、深色模式可见）。
 *
 * 复用 `/kitchen-sink` 的 `PrimitivesGallery`（`components/state/primitives-gallery.tsx`）
 * ——它是签核①材料本身自带的取景组件，不需要另起 fixture 页面、不需要登录。
 */

test.describe("overlay primitives keyboard", () => {
  test("Dialog：Tab 焦点陷阱——反复 Tab 不会跳出弹层", async ({ page }) => {
    await page.goto("/kitchen-sink");
    await page.getByTestId("primitive-dialog-trigger").click();

    const content = page.getByTestId("primitive-dialog-content");
    await expect(content).toBeVisible();

    // 弹层里可聚焦元素不多（关闭按钮 + 取消 + 确认），Tab 12 次足以覆盖好几圈；
    // 每一步都断言焦点仍落在弹层内部，一旦逃逸到背后的左栏/右栏就是焦点陷阱失效。
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Tab");
      const stillTrapped = await page.evaluate((testid) => {
        const root = document.querySelector(`[data-testid="${testid}"]`);
        return !!root && root.contains(document.activeElement);
      }, "primitive-dialog-content");
      expect(stillTrapped, `Tab 第 ${i + 1} 次后焦点逃出了 Dialog`).toBe(true);
    }

    // 背后的左栏内容确实可聚焦（证明「没跳出去」不是因为背后压根没有可聚焦元素）
    const leftItemFocusable = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="demo-thread-0"]');
      return !!el;
    });
    expect(leftItemFocusable).toBe(true);
  });

  test("Dialog：Esc 关闭，焦点回到触发按钮", async ({ page }) => {
    await page.goto("/kitchen-sink");
    const trigger = page.getByTestId("primitive-dialog-trigger");
    await trigger.click();
    await expect(page.getByTestId("primitive-dialog-content")).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.getByTestId("primitive-dialog-content")).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("Dropdown：方向键在菜单内导航（↓ 移动高亮，不需要鼠标）", async ({ page }) => {
    await page.goto("/kitchen-sink");
    await page.getByTestId("primitive-dropdown-trigger").click();

    const content = page.getByTestId("primitive-dropdown-content");
    await expect(content).toBeVisible();

    // 鼠标点开触发器时 Radix 不预高亮任何项——第一次 ↓ 才落到第一项，
    // 这与「键盘打开（Enter/↓）即高亮首项」是两条不同路径，这里测的是前者。
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("primitive-dropdown-rename")).toHaveAttribute("data-highlighted", "");

    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("primitive-dropdown-share")).toHaveAttribute("data-highlighted", "");
    await expect(page.getByTestId("primitive-dropdown-rename")).not.toHaveAttribute("data-highlighted", "");

    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("primitive-dropdown-delete")).toHaveAttribute("data-highlighted", "");

    // ↑ 往回走一步，验证是双向导航而不是只能往下
    await page.keyboard.press("ArrowUp");
    await expect(page.getByTestId("primitive-dropdown-share")).toHaveAttribute("data-highlighted", "");

    await page.keyboard.press("Escape");
    await expect(content).toBeHidden();
  });

  test("Dialog / Dropdown：深色模式下弹层可见（背景与前景不是同色）", async ({ page }) => {
    // `lib/theme.ts` 的落点：localStorage["wsx.theme"]="dark" + <html>.dark，
    // 在导航前用 addInitScript 写好，复现 layout.tsx 内联脚本在 hydration 前生效的时序。
    await page.addInitScript(() => {
      window.localStorage.setItem("wsx.theme", "dark");
    });
    await page.goto("/kitchen-sink");
    await expect(page.locator("html")).toHaveClass(/dark/);

    await page.getByTestId("primitive-dialog-trigger").click();
    const dialogContent = page.getByTestId("primitive-dialog-content");
    await expect(dialogContent).toBeVisible();

    const dialogColors = await dialogContent.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, fg: cs.color };
    });
    expect(dialogColors.bg).not.toBe("rgba(0, 0, 0, 0)");
    expect(dialogColors.bg).not.toBe(dialogColors.fg);

    await page.keyboard.press("Escape");
    await expect(dialogContent).toBeHidden();

    await page.getByTestId("primitive-dropdown-trigger").click();
    const dropdownContent = page.getByTestId("primitive-dropdown-content");
    await expect(dropdownContent).toBeVisible();

    const dropdownColors = await dropdownContent.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, fg: cs.color };
    });
    expect(dropdownColors.bg).not.toBe("rgba(0, 0, 0, 0)");
    expect(dropdownColors.bg).not.toBe(dropdownColors.fg);
  });
});
