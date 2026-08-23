import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * F08 —— axe-core `image-alt` 规则接入，作为图片可访问性标注的自动化回归
 * （`phases/phase-12-uiux-foundation/requirements/05-image-icon-accessibility.md#R3`
 * 第 5 步）。
 *
 * ## 为什么用 /kitchen-sink
 * 与 F01 的 `overlay-primitives-keyboard.spec.ts` 同一个理由：`/kitchen-sink` 是
 * `AppShell` 包裹的设计系统活文档页，不读 DB、不需要登录态——但它并不是空页面：
 * `AppShell` 的顶栏渲染了组织菜单（`components/shell/org-menu.tsx` 的
 * `<img alt="">` 头像回退、按钮 `aria-label` 承载可访问名），`ButtonGallery` /
 * `PrimitivesGallery` 铺了大量 `lucide-react` 图标。真跑一次 axe `image-alt`
 * 规则能覆盖到「组织头像 img」与「装饰图标」两类真实产物，不是对着空 DOM 断言通过。
 *
 * ## 只锁 image-alt 一条规则
 * `AxeBuilder().withRules(["image-alt"])` 而不是跑整份 axe 规则集——本 feature
 * 的验收范围是图片/图标可访问性标注，其余 axe 规则（对比度、地标等）分属别的
 * feature，混进来会让这条 spec 的失败原因变得含糊。
 */
test.describe("axe image-alt", () => {
  test("axe image-alt：/kitchen-sink 零违规", async ({ page }) => {
    await page.goto("/kitchen-sink");
    await expect(page.getByTestId("section-states")).toBeVisible();

    const results = await new AxeBuilder({ page }).withRules(["image-alt"]).analyze();

    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
});
