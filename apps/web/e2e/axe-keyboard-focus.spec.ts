import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * F06 —— axe-core keyboard/focus 规则接入 CI，作为键盘可访问性的自动化回归
 * （`phases/phase-12-uiux-foundation/requirements/03-keyboard-accessibility.md#R6`）。
 *
 * ## 为什么用 /kitchen-sink
 * 与 F01 的 `overlay-primitives-keyboard.spec.ts`、F08 的 `axe-image-alt.spec.ts`
 * 同一个理由：`/kitchen-sink` 是 `AppShell` 包裹的设计系统活文档页，不读 DB、不需要
 * 登录态——但它并不是空页面：`AppShell` 顶栏含可聚焦的组织菜单/按钮，
 * `ButtonGallery`/`PrimitivesGallery`/`Tabs`/`Dialog`/`Dropdown` 铺了大量真实
 * 可聚焦交互元素与 landmark 结构，真跑一次 axe keyboard 规则集能覆盖到真实产物，
 * 不是对着空 DOM 断言通过。
 *
 * ## 只锁 cat.keyboard 一组规则
 * `AxeBuilder().withTags(["cat.keyboard"])` 而不是跑整份 axe 规则集——本 feature
 * 的验收范围是键盘/焦点可访问性，其余 axe 规则（对比度、图片替代文本等）分属别的
 * feature（F08 已单独锁 `image-alt`），混进来会让这条 spec 的失败原因变得含糊。
 * `cat.keyboard` 实测覆盖 `accesskeys`/`bypass`/`focus-order-semantics`/
 * `frame-focusable-content`/`nested-interactive`/`region`/
 * `scrollable-region-focusable`/`skip-link`/`tabindex` 九条规则
 * （`axe.getRules(["cat.keyboard"])`，2026-08-24 实测于 axe-core 4.13.0）。
 */
test.describe("axe keyboard", () => {
  test("axe keyboard：/kitchen-sink 零违规", async ({ page }) => {
    await page.goto("/kitchen-sink");
    await expect(page.getByTestId("section-states")).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(["cat.keyboard"]).analyze();

    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
});
