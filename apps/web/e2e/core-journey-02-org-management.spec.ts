/**
 * 核心旅程 ②：组织管理——建团队、邀请新成员、受邀人激活账号、管理员看到他真的在组织里。
 *
 * ⚠ 这条旅程此前**没有任何浏览器级 e2e 覆盖**（`grep -rn "org-admin-invite" apps/web/e2e`
 * 零命中，唯一相关的是一条钉住 `noValidate` 细节的组件测试
 * `tests/ui/org-admin-invite-form-novalidate.test.tsx`）——邀请→一次性激活链接→受邀人
 * 用它建账号这条完整链路，产品代码写了（`org-admin-screen.tsx` 的
 * `InviteMemberForm`/`OneTimeActivationLink`/`app/(entry)/auth/activate`），却从未被真实
 * 浏览器走过一遍。本文件补的正是这个缺口，不是重复 `org-admin-keyboard-navigation.spec.ts`
 * （那条测的是键盘可达性）或 `self-service-profile.spec.ts`（那条测团队 CRUD + 个人资料）。
 *
 * 复用种子里的组织管理员（`FULLSTACK_E2E.adminEmail`）——「谁能邀请/管理团队」判组织
 * 管理员，与 `self-service-profile.spec.ts` 同一个账号、同一条权限判据。
 */
import { expect, test, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.adminEmail);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

test("旅程②：组织管理员建团队 → 邀请一位新成员 → 受邀人用一次性链接激活账号 → 出现在成员列表里", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const unique = Date.now();

  await loginAsAdmin(page);
  await page.goto("/org-admin");
  await expect(page.getByTestId("org-admin-screen")).toBeVisible();

  /* ── ① 建一个团队（复用 self-service-profile.spec.ts 已验证过的写路径） ──
        下面第②步会把新成员真的分进这个团队（选中 `org-admin-invite-team` 里对应
        的 teamId），第⑤步核对团队成员数真的从 0 变成 1——不是建完就晾在一边的
        摆设脚手架。 */
  const teamName = `旅程②团队-${unique}`;
  await page.getByTestId("org-admin-tab-teams").click();
  await expect(page.getByTestId("org-admin-team-list")).toBeVisible();
  const createTeamResponsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST" && /\/organizations\/[^/]+\/teams\/create$/.test(response.url())
  ));
  await page.getByTestId("org-admin-create-team-input").fill(teamName);
  await page.getByTestId("org-admin-create-team").click();
  const createdTeam = await (await createTeamResponsePromise).json() as { teamId: string; name: string };
  const teamId = createdTeam.teamId;
  expect(teamId, "建团队必须拿到真实 teamId，后面选团队要用它").toBeTruthy();
  await expect(page.getByTestId("org-admin-team-banner")).toContainText("已创建");
  const teamRow = page.getByTestId("org-admin-team-list").locator("li", { hasText: teamName });
  await expect(teamRow).toBeVisible();
  // 反空转基线：新建的团队此刻真的是 0 人，下面才能证明"邀请分进了这个团队"
  // 让这个数从 0 变成了 1，而不是它本来就非零、断言巧合对上。
  await expect(page.getByTestId(`org-admin-team-${teamId}-member-count`)).toContainText("0");

  /* ── ② 邀请一位新成员到这个团队 ────────────────────────────────────────
     ⚠ 邀请角色用非 admin（默认 `member`）：邀请 admin 需要双人复核
     （`org-admin-invite-dual-review-note`），链接不会立刻签发，那是另一条更复杂的
     旅程，不在本条覆盖范围内——本条要证的是"邀请→激活→出现在组织里"这条主链路
     本身，不是复核细节。 */
  const inviteEmail = `journey02-invite-${unique}@example.test`;
  // 实测：邀请表单在独立的「邀请」tab 里，不是「成员」tab 的一部分——`org-admin-screen
  // .tsx` 的 `TabsList` 有团队/成员/邀请/组织资料四个 tab，`InviteMemberForm` 挂在
  // `org-admin-tab-invites` 下面。
  await page.getByTestId("org-admin-tab-invites").click();
  await expect(page.getByTestId("org-admin-invite-form")).toBeVisible();
  await page.getByTestId("org-admin-invite-email").fill(inviteEmail);
  // 真的选中第①步建的那个团队——不选的话 `teamId` 默认是 `NO_TEAM`，第①步的团队
  // 就成了从未被用上的摆设（实测钉住过这个坑，见本文件 git blame 的修复记录）。
  await page.getByTestId("org-admin-invite-team").click();
  await page.getByTestId(`org-admin-invite-team-option-${teamId}`).click();
  await expect(page.getByTestId("org-admin-invite-team")).toHaveAttribute("aria-label", new RegExp(teamName));
  const inviteResponsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST" && /\/organizations\/[^/]+\/invites(\?|$)/.test(response.url())
  ));
  await page.getByTestId("org-admin-invite-submit").click();
  const inviteResponse = await inviteResponsePromise;
  expect(inviteResponse.ok(), "邀请提交必须成功").toBeTruthy();

  // ── 一次性激活链接出现，且**只会出现这一次**（界面自己的承诺，见组件头注） ──
  await expect(page.getByTestId("org-admin-invite-link-block")).toBeVisible();
  const activationUrl = await page.getByTestId("org-admin-invite-link-url").inputValue();
  expect(activationUrl, "必须真的拿到一条激活链接，不是空字符串").toContain("/auth/activate");
  await page.getByTestId("org-admin-invite-link-dismiss").click();
  await expect(page.getByTestId("org-admin-invite-link-block")).toHaveCount(0);

  /* ── ③ 受邀人在**独立浏览器上下文**里打开激活链接、建账号 ──────────────────
     独立 context 而不是复用同一个 page：受邀人与邀请人是两个不同的人，同一个
     `page` 里先后登录两个账号容易把会话状态搞混，与 fullstack-smoke-fixture.ts
     里"并发登录会互相踢设备会话"那条纪律同一个理由——两个人本来就该是两个会话。 */
  const inviteeContext = await browser.newContext();
  const inviteePage = await inviteeContext.newPage();
  await inviteePage.goto(activationUrl);
  await expect(inviteePage.getByTestId("activate-form")).toBeVisible();
  // 默认就是「新建账号」模式（受邀人还没有 workspacex 账号）——组件没有 aria-pressed，
  // 靠"姓名"输入框默认就可见来判断当前落在 new 分支（实测：该组件只用 Button
  // variant 视觉区分选中态，不带任何可查询的选中态属性）。
  const inviteeName = `旅程②受邀人-${unique}`;
  const inviteePassword = `Journey02-Invitee-${unique}!`;
  await inviteePage.getByTestId("activate-name").fill(inviteeName);
  await inviteePage.getByTestId("activate-pwd").fill(inviteePassword);
  await inviteePage.getByTestId("activate-submit").click();
  await expect(inviteePage.getByTestId("activate-success")).toBeVisible({ timeout: 20_000 });
  // 实测：「继续」按钮把人带回 `/login`，不是直接落地到已登录的 `/projects`——
  // 账号建好了，但激活本身不附带自动登录。下面第 ④ 步用这个新密码显式登录，
  // 就是对这件事的真正验证，这里不断言一个不存在的自动登录行为。
  await inviteePage.getByTestId("activate-success-continue").click();
  await expect(inviteePage).toHaveURL(/\/login/);
  await inviteeContext.close();

  /* ── ④ 受邀人真的能用这个账号登录（不是激活页自己乐观渲染出来的假象） ────────── */
  const reloginContext = await browser.newContext();
  const reloginPage = await reloginContext.newPage();
  await reloginPage.goto("/login");
  await reloginPage.getByTestId("login-email").fill(inviteEmail);
  await reloginPage.getByTestId("login-password").fill(inviteePassword);
  await reloginPage.getByTestId("login-submit").click();
  await expect(reloginPage).toHaveURL(/\/projects$/);
  await reloginContext.close();

  /* ── ⑤ 管理员刷新组织后台，能看到这位新成员真的在组织成员列表里 ──────────────
     「刷新后仍在」区分「写进 PostgreSQL」与「只是激活页自己的乐观 UI」。 */
  await page.reload();
  await page.getByTestId("org-admin-tab-members").click();
  await expect(page.getByTestId("org-admin-member-list")).toContainText(inviteeName);

  // ── 反证收口：这个人真的分进了第①步那个团队，不是"邀请表单选了团队但服务端
  //    没接住"——团队人数要从 0 真的变成 1，而不是停在成员列表里"看起来存在"。
  await page.getByTestId("org-admin-tab-teams").click();
  await expect(page.getByTestId(`org-admin-team-${teamId}-member-count`)).toContainText("1");
});
