/**
 * 核心旅程 ⑥（项目中枢 R10，用户直接交办的十轮 ad-hoc 迭代收口）：
 *
 *   非成员打开项目被拒 → 引导师生成邀请链接 → 成员登录（带 `?next=`）打开链接加入
 *   → 引导师在项目里新建 chat → 把它分享到「全场」→ 成员在同一列表看到这条 chat
 *   → 成员打开研究洞察，「项目大脑」面板对成员如实渲染（不是 403）。
 *
 * 链路一节不许省：Chromium → Next 同源代理 → NestJS（project-invite / chat / knowledge-graph
 * controller）→ application 用例 → pg 仓储 → PostgreSQL。中途没有任何一处塞假数据。
 *
 * ## 为什么用种子里的 member 账号做「被邀请的人」
 *
 * `seed-fullstack-smoke.ts` 只把 member 加进组织（consultant），**没有**加进 sentinel 项目——
 * 他正是「组织成员但非项目成员」这一格：本旅程第一步用他反证「项目是受邀才能进的容器」
 * （`GET /projects/:id/overview` ⇒ 403 `NO_PROJECT_ROLE`，界面 `project-access-denied`），
 * 没有这一步，后面「加入后看得到」证明不了邀请这一环真的在把关。
 *
 * ## 为什么分享要真的切到「全场」
 *
 * 项目里新建的 chat 默认 `group-shared`（`mutate-thread.ts` 的 create 分支），而通过邀请链接进来的
 * member `groupId = null`——他看不到本组共享的线程。引导师把它切成「全场」（R5 的 `setVisibility`）
 * 之后 member 才看得到：这一步不是装饰，去掉它第 5 步会红。
 *
 * ⚠ 有状态：会把 member 真的加进 sentinel 项目、留下一条全场 chat。排在
 *   `seeded-github-import` 链（与旅程 ③ ④ 同理，见 playwright.fullstack-smoke.config.ts 头注），
 *   不进 `seeded` 那条断言空态的链。
 */
import { expect, test, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

/** 切账号前先清掉上一个人的会话（同旅程 ④ 的既有做法）。 */
async function logout(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.evaluate(() => window.localStorage.clear()).catch(() => {});
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

const PROJECT = FULLSTACK_E2E.projectId;
const workbench = (q = "") => `/projects/${encodeURIComponent(PROJECT)}${q}`;

test("旅程⑥：非成员被拒 → 引导师发邀请 → 成员经链接加入 → 引导师建 chat 并分享到全场 → 成员看得到 chat 与项目大脑", async ({ page }) => {
  test.setTimeout(150_000);

  // ① 反证前提：member 现在进不了这个项目。
  await logout(page);
  await page.goto("/login");
  await login(page, FULLSTACK_E2E.memberEmail, FULLSTACK_E2E.memberPassword);
  await expect(page).toHaveURL(/\/projects$/);
  await page.goto(workbench());
  await expect(page.getByTestId("project-access-denied")).toBeVisible();

  // ② 引导师在 设置 tab 生成邀请链接（默认身份「成员」、有效期 7 天）。
  await logout(page);
  await page.goto("/login");
  await login(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);
  await expect(page).toHaveURL(/\/projects$/);
  await page.goto(workbench("?tab=settings"));
  await expect(page.getByTestId("project-invite-panel")).toBeVisible();
  await page.getByTestId("project-invite-issue").click();
  const inviteLink = await page.getByTestId("project-invite-link-url").inputValue();
  expect(inviteLink).toContain("/projects/join?t=");
  const invitePath = new URL(inviteLink).pathname + new URL(inviteLink).search;

  // ③ member 退出后打开链接：落地页先把他送去登录、登录后回到落地页、加入、进入项目工作台。
  await logout(page);
  await page.goto(invitePath);
  await expect(page).toHaveURL(/\/login\?next=/);
  await login(page, FULLSTACK_E2E.memberEmail, FULLSTACK_E2E.memberPassword);
  await expect(page.getByTestId("project-join")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT}$`), { timeout: 20_000 });
  await expect(page.getByTestId("project-title")).toBeVisible();
  await expect(page.getByTestId("project-access-denied")).toHaveCount(0);

  // ④ 引导师在 研究洞察 › 对话 新建 chat，并把它切到「全场」。
  await logout(page);
  await page.goto("/login");
  await login(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);
  await expect(page).toHaveURL(/\/projects$/);
  await page.goto(workbench("?tab=research&sub=conv"));
  await expect(page.getByTestId("project-conversations")).toBeVisible();
  const createResponse = page.waitForResponse((r) =>
    r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/chat/threads/mutate") && r.request().postDataJSON()?.op === "create");
  await page.getByTestId("project-conversations-new").click();
  const created = await createResponse;
  expect(created.status()).toBe(200);
  const threadId = (await created.json()).threadId as string;
  expect(threadId).toBeTruthy();
  const card = page.getByTestId(`project-conversation-${threadId}`);
  await expect(card).toBeVisible();
  await expect(card).toContainText("本组共享");
  const share = page.waitForResponse((r) =>
    r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/chat/threads/mutate") && r.request().postDataJSON()?.op === "setVisibility");
  await page.getByTestId(`project-conversation-share-${threadId}`).click();
  await page.getByRole("menuitemradio", { name: "全场" }).click();
  expect((await share).status()).toBe(200);
  await expect(card).toContainText("全场");

  // ⑤ member 在同一列表看到这条 chat；研究洞察的「项目大脑」对成员如实渲染。
  await logout(page);
  await page.goto("/login");
  await login(page, FULLSTACK_E2E.memberEmail, FULLSTACK_E2E.memberPassword);
  await expect(page).toHaveURL(/\/projects$/);
  await page.goto(workbench("?tab=research&sub=conv"));
  await expect(page.getByTestId(`project-conversation-${threadId}`)).toBeVisible();
  await page.goto(workbench("?tab=research"));
  await expect(page.getByTestId("project-brain")).toBeVisible();
  await expect(page.getByTestId("project-brain-error")).toHaveCount(0);
  await expect(page.getByTestId("project-brain-empty").or(page.getByTestId("project-brain-groups"))).toBeVisible();
});
