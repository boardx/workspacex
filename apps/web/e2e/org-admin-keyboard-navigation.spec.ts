/**
 * F06 —— org-admin 核心任务全键盘可达（`03-keyboard-accessibility.md#R6`，issue #1930）。
 *
 * 只验一条核心任务，逐字对齐 issue #1930 的 user_visible_behavior：
 * "只用键盘即可在 org-admin 完成『打开一个成员的权限设置弹层并调整』（在有管理权限
 * 的角色登录态下）"。
 *
 * ## 「权限设置弹层」是什么
 * org-admin 这一轮范围里对既有成员唯一可调整的权限类控件是"成员"标签页每行的
 * 「Skill 审核人职能」下拉（`ReviewerFunctionPicker`，`org-admin-screen.tsx`）——
 * 仅组织 admin 渲染可见，改动会真的调用 `assignSkillReviewerFunction`/
 * `revokeSkillReviewerFunction` 写库（issue #852）。这是当前产品范围内真实存在、
 * 唯一"调整一个成员的权限"的控件。
 *
 * ⚠ 本 feature 开工时它原本是原生 `<select>`——实测（issue #1930 讨论）发现原生
 * `<select>` 的下拉弹层是浏览器渲染的 OS 级控件，Playwright 的合成键盘事件
 * （CDP `Input.dispatchKeyEvent`）能让它聚焦，但四种按键序列
 * （`ArrowDown`／`Enter+ArrowDown+Enter`／`Space+ArrowDown+Enter`／
 * `Alt+ArrowDown+ArrowDown+Enter`，含 headless-shell 与完整 chromium 两种二进制）
 * 均无法驱动它真正改值——这正是 F06 要证的核心任务本身撞到的真实卡点，不是测试
 * 写法问题。已改为复用既有的 `PopoverSelect`（同 `top-bar.tsx` 的 `OrgSwitcher`/
 * 本页邀请表单"组织角色"下拉同一套弹层单选实现，真实 DOM 按钮 + `role=listbox`，
 * 不依赖浏览器原生弹层），对真实用户和自动化测试都是可键盘操作的。
 *
 * ## 为什么用独立账号对
 * 见 `self-service-profile-fixture.ts` 里 `orgAdminKeyboardAdminEmail`/
 * `orgAdminKeyboardMemberEmail` 字段头注：admin 角色是 `ReviewerFunctionPicker`
 * 渲染的前提条件，`keyboardEmail`（consultant）验不出这条控件；且不与
 * `self-service-profile.spec.ts` 的 admin 账号共享登录态，避免执行顺序耦合。
 *
 * 全程不调用 `page.mouse`，也不对任何按钮/标签/下拉用 `.click()`——用
 * `locator.focus()`（JS 层 `element.focus()`，不是鼠标事件）把光标带到走查起点，
 * 之后全靠 `page.keyboard.press` 推进：Tab 走查到目标标签/按钮，方向键切换标签，
 * Enter 打开弹层/确认选项。登录是测试前置条件，`.fill()`/`.click()` 沿用仓库既有
 * 登录样板（同 `profile-keyboard-navigation.spec.ts`）。
 */
import { expect, test } from "@playwright/test";
import { SELF_SERVICE_PROFILE_E2E } from "./self-service-profile-fixture";

test.describe("keyboard org-admin：org-admin 核心任务全键盘可达", () => {
  test("keyboard org-admin：只用键盘打开一个成员的权限设置并调整", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("login-email").fill(SELF_SERVICE_PROFILE_E2E.orgAdminKeyboardAdminEmail);
    await page.getByTestId("login-password").fill(SELF_SERVICE_PROFILE_E2E.orgAdminKeyboardAdminPassword);
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/projects$/);

    await page.goto("/org-admin");
    await expect(page.getByTestId("org-admin-screen")).toBeVisible();

    // 起点：默认落在"团队"标签（`Tabs defaultValue="teams"`）。走查起点放在这个
    // 已知的、当前激活的标签触发器上——不是直接 `.focus()` 目标控件抄近路。
    await page.getByTestId("org-admin-tab-teams").focus();
    await expect(page.getByTestId("org-admin-tab-teams")).toBeFocused();

    // Radix Tabs 默认 activationMode="automatic"：方向键在标签列表内移动焦点的
    // 同时就切换激活标签，不需要额外 Enter——这正是 R6 要求的「方向键」可达。
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("org-admin-tab-members")).toBeFocused();
    await expect(page.getByTestId("org-admin-tab-members")).toHaveAttribute("data-state", "active");
    await expect(page.getByTestId("org-admin-member-list")).toBeVisible();

    const targetUserId = SELF_SERVICE_PROFILE_E2E.orgAdminKeyboardMemberUserId;
    const pickerTestId = `org-admin-member-${targetUserId}-reviewer-function`;
    const pickerTrigger = page.getByTestId(pickerTestId);
    await expect(pickerTrigger).toHaveText("无审核职能");
    await expect(pickerTrigger).toHaveAttribute("aria-expanded", "false");

    // 从标签触发器开始，Tab 走查应能在有限步数内到达目标成员的权限下拉按钮——这正是
    // R6「Tab 顺序符合视觉顺序」的核心断言，不是直接 `.focus()` 控件抄近路。
    let reachedPicker = false;
    for (let step = 0; step < 40; step += 1) {
      await page.keyboard.press("Tab");
      const activeTestId = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);
      if (activeTestId === pickerTestId) {
        reachedPicker = true;
        break;
      }
    }
    expect(reachedPicker, `从"成员"标签开始，Tab 走查应在有限步数内到达目标成员的权限下拉按钮（${pickerTestId}）`).toBe(true);
    await expect(pickerTrigger).toBeFocused();

    // 「打开」——Enter 激活按钮，弹出 `role=listbox`。
    await page.keyboard.press("Enter");
    await expect(pickerTrigger).toHaveAttribute("aria-expanded", "true");
    const listbox = page.getByTestId(`${pickerTestId}-listbox`);
    await expect(listbox).toBeVisible();

    // 「调整」——弹层内是真实 DOM 按钮，Tab 走查到目标选项（方法论审核人），Enter
    // 确认，触发真实 `assignSkillReviewerFunction` 写库。
    const targetOption = page.getByTestId(`${pickerTestId}-option-methodology-reviewer`);
    let reachedOption = false;
    for (let step = 0; step < 10; step += 1) {
      await page.keyboard.press("Tab");
      const activeTestId = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);
      if (activeTestId === `${pickerTestId}-option-methodology-reviewer`) {
        reachedOption = true;
        break;
      }
    }
    expect(reachedOption, "弹层打开后 Tab 走查应能在有限步数内到达目标选项（方法论审核人）").toBe(true);
    await expect(targetOption).toBeFocused();

    const assignResponsePromise = page.waitForResponse((response) => (
      response.request().method() === "POST"
      && response.url().includes(`/organizations/${SELF_SERVICE_PROFILE_E2E.orgId}/members/${targetUserId}/skill-reviewer-function`)
      && !response.url().endsWith("/revoke")
    ));
    await page.keyboard.press("Enter");
    const assignResponse = await assignResponsePromise;
    expect(assignResponse.status()).toBe(201);
    const assignBody = await assignResponse.json();
    expect(assignBody).toMatchObject({ userId: targetUserId, reviewerFunction: "methodology-reviewer" });

    // 选中后弹层应自动关闭（`PopoverSelect` 的 `onSelect` 里 `setOpen(false)`）。
    await expect(listbox).toBeHidden();
    await expect(pickerTrigger).toHaveText("方法论审核人");
    // 调整后焦点不应该丢到 body/不可见元素——按钮本身仍是可继续操作的焦点载体。
    const activeAfterAssign = await page.evaluate(() => document.activeElement?.tagName ?? null);
    expect(activeAfterAssign, "调整权限后焦点不应丢失到 body/不可见元素").not.toBe("BODY");

    // Esc 可关闭弹层（R3/R6 的既有纪律，同 `PopoverSelect` 本身已实现的
    // `Escape` 处理）——重新打开一次，验证 Esc 生效且不改变已保存的值。
    await page.keyboard.press("Enter");
    await expect(listbox).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(listbox).toBeHidden();
    await expect(pickerTrigger).toHaveText("方法论审核人");

    // 刷新后仍在——证明真的写库，不是只改了 React state（同
    // `profile-keyboard-navigation.spec.ts` 的纪律）。刷新后 `Tabs` 会回到
    // `defaultValue="teams"`（未持久化在 URL 里），"成员"标签内容随之卸载——
    // 用同一套键盘走查（Tab 到标签、方向键切换）重新进入"成员"标签再断言，
    // 不是抄近路直接 `.focus()` 目标控件。
    await page.reload();
    await expect(page.getByTestId("org-admin-screen")).toBeVisible();
    await page.getByTestId("org-admin-tab-teams").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("org-admin-tab-members")).toHaveAttribute("data-state", "active");
    await expect(page.getByTestId(pickerTestId)).toHaveText("方法论审核人");
  });
});
