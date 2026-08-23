/**
 * F05 —— profile 核心任务全键盘可达（`03-keyboard-accessibility.md#R3`）。
 *
 * 只验一条核心任务，逐字对齐 issue #1869 的 user_visible_behavior：
 * "在 profile 完成『修改一项资料并保存』"——修改显示名并保存，刷新后仍在
 * （证明真的写库，不是只改了 React state，同 `self-service-profile.spec.ts` 的既有纪律）。
 *
 * 全程不调用 `page.mouse`，也不对表单控件用 `.click()`——用 `locator.focus()`
 * （JS 层 `element.focus()`，不是鼠标事件）把光标带到走查起点，之后全靠
 * `page.keyboard.press`/`page.keyboard.type` 推进。登录是测试前置条件，不是本 feature
 * 要证的核心任务，`.fill()`/`.click()` 沿用仓库既有登录样板。
 *
 * 用独立的 `keyboardEmail` 账号（`self-service-profile-fixture.ts` 头注）：
 * `self-service-profile.spec.ts` 的 admin 账号会在自己的用例里真的改密码，共用账号
 * 会让本文件的执行结果依赖那条用例的执行顺序。
 */
import { expect, test } from "@playwright/test";
import { SELF_SERVICE_PROFILE_E2E } from "./self-service-profile-fixture";

test.describe("keyboard profile：profile 核心任务全键盘可达", () => {
  test("keyboard profile：只用键盘修改显示名并保存", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("login-email").fill(SELF_SERVICE_PROFILE_E2E.keyboardEmail);
    await page.getByTestId("login-password").fill(SELF_SERVICE_PROFILE_E2E.keyboardPassword);
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/projects$/);

    await page.goto("/profile");
    await expect(page.getByTestId("profile-screen")).toBeVisible();

    // 走查起点：页面刚落地时的默认焦点（document.body）。真正要验证的是从这里按 Tab
    // 能不能在有限步数内到达显示名输入框——这正是 R3 的「Tab 顺序符合视觉顺序」要求，
    // 不是直接 `.focus()` 输入框抄近路。
    let reachedNameInput = false;
    for (let step = 0; step < 40; step += 1) {
      await page.keyboard.press("Tab");
      const activeTestId = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);
      if (activeTestId === "profile-display-name-input") {
        reachedNameInput = true;
        break;
      }
    }
    expect(reachedNameInput, "从页面默认焦点开始，Tab 走查应在有限步数内到达显示名输入框（profile-display-name-input）").toBe(true);
    await expect(page.getByTestId("profile-display-name-input")).toBeFocused();

    // 全选已有内容再输入新值——不用鼠标三击/拖选，用键盘的「全选」快捷键。
    const newDisplayName = "SSP E2E Keyboard 改名后";
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type(newDisplayName);
    await expect(page.getByTestId("profile-display-name-input")).toHaveValue(newDisplayName);

    // 继续 Tab 到「保存」按钮，Enter 触发——不点鼠标。
    let reachedSaveButton = false;
    for (let step = 0; step < 10; step += 1) {
      await page.keyboard.press("Tab");
      const activeTestId = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);
      if (activeTestId === "profile-save") {
        reachedSaveButton = true;
        break;
      }
    }
    expect(reachedSaveButton, "从显示名输入框开始，Tab 走查应在有限步数内到达保存按钮（profile-save）").toBe(true);
    await expect(page.getByTestId("profile-save")).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("profile-display-name-input")).toHaveValue(newDisplayName);

    // 刷新后仍在——证明真的写库，不是只改了 React state（同 self-service-profile.spec.ts 的纪律）。
    await page.reload();
    await expect(page.getByTestId("profile-display-name-input")).toHaveValue(newDisplayName);
  });
});
