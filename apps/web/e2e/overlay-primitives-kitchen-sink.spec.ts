import { test, expect } from "@playwright/test";

/**
 * F02 —— 统一的 Select / Tooltip 弹层原语 + kitchen-sink 展示区完整性（真实浏览器）。
 *
 * `/kitchen-sink` 的 `PrimitivesGallery`（`components/state/primitives-gallery.tsx`）
 * 是 dialog/dropdown/select/tooltip 四个原语签核①材料的取景组件，与
 * `overlay-primitives-keyboard.spec.ts`（F01）同一套「不需要登录、不需要种子数据」的
 * 静态页面前提，因此复用同一个 project，不另起 webServer/依赖链。
 */

test.describe("kitchen sink overlays", () => {
  test("四个弹层原语展示区块（dialog/dropdown/select/tooltip）均可见", async ({ page }) => {
    await page.goto("/kitchen-sink");

    await expect(page.getByTestId("primitive-dialog")).toBeVisible();
    await expect(page.getByTestId("primitive-dropdown")).toBeVisible();
    await expect(page.getByTestId("primitive-select")).toBeVisible();
    await expect(page.getByTestId("primitive-tooltip")).toBeVisible();
  });

  test("Select：可展开、可选中、触发按钮文案随选中值更新", async ({ page }) => {
    await page.goto("/kitchen-sink");

    const trigger = page.getByTestId("primitive-select-trigger");
    await expect(trigger).toBeVisible();
    await expect(trigger).toContainText("组员（可参与、可产出）");

    await trigger.click();
    const content = page.locator('[role="menu"]').first();
    await expect(content).toBeVisible();

    await page.getByRole("menuitemradio", { name: /引导师/ }).click();
    await expect(trigger).toContainText("引导师（可下发、可编辑）");
  });

  test("Select：禁用态不可展开", async ({ page }) => {
    await page.goto("/kitchen-sink");

    const disabledTrigger = page.getByTestId("primitive-select-disabled");
    await expect(disabledTrigger).toBeDisabled();
  });

  test("Select：超长下拉列表（40 项）在视口内可滚动截断，不撑爆页面", async ({ page }) => {
    await page.goto("/kitchen-sink");

    const trigger = page.getByTestId("primitive-select-long-trigger");
    await trigger.click();

    const content = page.locator('[role="menu"]').filter({ hasText: "成员 1 号" });
    await expect(content).toBeVisible();

    const box = await content.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (box && viewport) {
      // content 高度必须明显小于「40 项全展开」会占的高度，且不超出视口——证明确实在滚动截断，
      // 不是简单把所有项塞进一个超高盒子。
      expect(box.height).toBeLessThan(viewport.height);
    }

    const overflowY = await content.evaluate((el) => getComputedStyle(el).overflowY);
    expect(["auto", "scroll"]).toContain(overflowY);

    await page.keyboard.press("Escape");
  });

  test("Tooltip：hover 触发气泡，禁用态触发不出气泡", async ({ page }) => {
    await page.goto("/kitchen-sink");

    const trigger = page.getByTestId("primitive-tooltip-trigger");
    await trigger.hover();
    await expect(page.getByTestId("primitive-tooltip-content")).toBeVisible();

    const disabledTrigger = page.getByTestId("primitive-tooltip-disabled-trigger");
    await expect(disabledTrigger).toBeDisabled();
    await disabledTrigger.hover({ force: true });
    await expect(page.getByTestId("primitive-tooltip-disabled-content")).toBeHidden();
  });
});
