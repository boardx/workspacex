/**
 * F06 —— org-admin 核心任务全键盘可达（`03-keyboard-accessibility.md#R6`，issue #1930）。
 *
 * 只验一条核心任务，逐字对齐 issue #1930 的 user_visible_behavior：
 * "只用键盘即可在 org-admin 完成『打开一个成员的权限设置弹层并调整』（在有管理权限
 * 的角色登录态下）"。
 *
 * ## issue #2615 改写：三个独立路由取代了原来的一页四标签
 * 本 feature 开工时 org-admin 是单一路由 `/org-admin`，内部一套 `Tabs`（团队/成员/邀请/
 * 组织资料四个标签页共享一页，方向键在标签间切换）——那套 `Tabs` 组件已随 issue #2615
 * （2026-09-03 人类裁决①）整体撤除："在后台的组织后台中，将组织管理下面的成员，邀请，
 * 组织资料，编程是和总览平级的功能"，现在是 `OrgMembersScreen`/`OrgInvitesScreen`/
 * `OrgProfileScreen` 三个独立路由（`/org-admin/members`/`/org-admin/invites`/
 * `/org-admin/profile`），各自套同一个左栏 `AdminNav`，不再是同页切标签。
 * ⇒ 本文件拆成两段：
 *   ① 三个独立左栏入口之间的键盘可达性——验证它们是真实 `<a>`（`AdminNav` 用 `Link`
 *      渲染，天然在 Tab 序列里，不需要任何自定义 roving tabindex），Tab 能顺序到达、
 *      Enter 能真的跳转，这是"标签切换"被拆成"路由切换"后键盘可达性对应的新形状。
 *   ② 核心任务本身（打开权限设置弹层并调整）——起点从"默认落在的团队标签"改成直接
 *      落在 `/org-admin/members`（它现在是独立路由，不再有默认标签这回事），后续的
 *      Tab 走查 / PopoverSelect 弹层操作与 F06 原始范围一字不改。
 *
 * ## 「权限设置弹层」是什么
 * org-admin 这一轮范围里对既有成员唯一可调整的权限类控件是"成员"屏每行的
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
 * 之后全靠 `page.keyboard.press` 推进：Tab 走查到目标链接/按钮，Enter 打开弹层/
 * 确认选项/跳转路由。登录是测试前置条件，`.fill()`/`.click()` 沿用仓库既有
 * 登录样板（同 `profile-keyboard-navigation.spec.ts`）。
 */
import { expect, test } from "@playwright/test";
import { SELF_SERVICE_PROFILE_E2E } from "./self-service-profile-fixture";

test.describe("keyboard org-admin：org-admin 核心任务全键盘可达", () => {
  test("keyboard org-admin：三个独立入口可键盘到达 + 只用键盘打开一个成员的权限设置并调整", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("login-email").fill(SELF_SERVICE_PROFILE_E2E.orgAdminKeyboardAdminEmail);
    await page.getByTestId("login-password").fill(SELF_SERVICE_PROFILE_E2E.orgAdminKeyboardAdminPassword);
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/projects$/);

    /* ── ① 三个独立左栏入口之间的键盘可达性 ──────────────────────────────
       "成员"→"邀请"→"组织资料" 现在是三条独立路由，不再是同页的三个标签——
       验证它们仍然是 Tab 序列里的真实链接（`AdminNav` 用 `Link` 渲染），且
       Enter 能真的把路由切过去，这是原来 R6「方向键切换标签」在拆平为路由之后
       对应的新形状：不再是"标签切换"，是"链接可达 + 可激活"。 */
    await page.goto("/org-admin/members");
    await expect(page.getByTestId("org-admin-screen")).toBeVisible();

    await page.getByTestId("admin-nav-org-members").focus();
    await expect(page.getByTestId("admin-nav-org-members")).toBeFocused();

    // 从「成员」链接开始，Tab 走查应能在有限步数内到达「邀请」链接——它是真实 <a>，
    // 不需要任何自定义按键处理就该在 Tab 序列里。
    let reachedInvitesLink = false;
    for (let step = 0; step < 20; step += 1) {
      await page.keyboard.press("Tab");
      const activeTestId = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);
      if (activeTestId === "admin-nav-org-invites") {
        reachedInvitesLink = true;
        break;
      }
    }
    expect(reachedInvitesLink, "从「成员」入口开始，Tab 走查应在有限步数内到达「邀请」入口链接").toBe(true);
    await expect(page.getByTestId("admin-nav-org-invites")).toBeFocused();

    // Enter 激活这条链接，真的把路由切到 /org-admin/invites——不是停在"聚焦到了"这一步。
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/org-admin\/invites$/);
    await expect(page.getByTestId("org-admin-screen")).toBeVisible();
    await expect(page.getByTestId("admin-nav-org-invites")).toHaveAttribute("aria-current", "page");

    // 继续从这里 Tab 走查到「组织资料」链接，同一条纪律。
    await page.getByTestId("admin-nav-org-invites").focus();
    let reachedProfileLink = false;
    for (let step = 0; step < 20; step += 1) {
      await page.keyboard.press("Tab");
      const activeTestId = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);
      if (activeTestId === "admin-nav-org-profile") {
        reachedProfileLink = true;
        break;
      }
    }
    expect(reachedProfileLink, "从「邀请」入口开始，Tab 走查应在有限步数内到达「组织资料」入口链接").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/org-admin\/profile$/);
    await expect(page.getByTestId("org-admin-screen")).toBeVisible();

    /* ── ② 核心任务：只用键盘打开一个成员的权限设置并调整 ──────────────────
       起点直接落在 `/org-admin/members`——它现在是独立路由，不再有"默认标签"
       这回事，不需要像原来那样先 Tab 到标签触发器再切换。 */
    await page.goto("/org-admin/members");
    await expect(page.getByTestId("org-admin-screen")).toBeVisible();
    await expect(page.getByTestId("org-admin-member-list")).toBeVisible();

    const targetUserId = SELF_SERVICE_PROFILE_E2E.orgAdminKeyboardMemberUserId;
    const pickerTestId = `org-admin-member-${targetUserId}-reviewer-function`;
    const pickerTrigger = page.getByTestId(pickerTestId);
    await expect(pickerTrigger).toHaveText("无审核职能");
    await expect(pickerTrigger).toHaveAttribute("aria-expanded", "false");

    // 从左栏「成员」入口开始，Tab 走查应能在有限步数内到达目标成员的权限下拉按钮——这正是
    // R6「Tab 顺序符合视觉顺序」的核心断言，不是直接 `.focus()` 控件抄近路。
    await page.getByTestId("admin-nav-org-members").focus();
    let reachedPicker = false;
    for (let step = 0; step < 40; step += 1) {
      await page.keyboard.press("Tab");
      const activeTestId = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);
      if (activeTestId === pickerTestId) {
        reachedPicker = true;
        break;
      }
    }
    expect(reachedPicker, `从左栏"成员"入口开始，Tab 走查应在有限步数内到达目标成员的权限下拉按钮（${pickerTestId}）`).toBe(true);
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
    // `profile-keyboard-navigation.spec.ts` 的纪律）。`/org-admin/members` 是独立路由，
    // 刷新后直接就在这个屏上，不需要像旧版那样重新走"标签切换"才能回到"成员"。
    await page.reload();
    await expect(page.getByTestId("org-admin-screen")).toBeVisible();
    await expect(page.getByTestId(pickerTestId)).toHaveText("方法论审核人");
  });
});
