/**
 * UC-17.8 B4.7 —— 设计工作台端到端：新建 → 详情 → 推送 → 收件箱出现设计方案 +
 * 原反馈标「已生成」。
 *
 * 覆盖两条创建入口，理由见下：
 *
 * ① 「新建」（workbench 自己的「新建设计」弹层，`createProject`，不挂 `linkedFeedbackId`）——
 *   这是 backlog B4.7 原文点名的主入口，也是最基础的一条：工作台首页新建 → 详情页
 *   （画布/说明两个 tab + 对话面板都渲染）→ 推送 → 收件箱里出现一条 `kind=design` 卡片。
 *
 * ② 「深化」（`inbox-screen.tsx` 「用 PM 设计工作台深化」按钮 → `POST /feedback/:id/deepen`，
 *   B4.4/B4.5 已真栈化）—— backlog 原文「原反馈标已生成」这半句，前提就是设计项目
 *   `linkedFeedbackId` 非空，只有深化入口才产生这个关联；直接新建的项目天然没有源反馈，
 *   断不出这半句。所以这条覆盖完整的六段闭环：新建（深化产生）→ 详情 → 推送 → 收件箱
 *   出现设计方案 → 原反馈卡片标「已生成方案」→ 收件箱详情 drawer 里「查看方案」可跳回。
 *
 * 两条用例都用管理员账号（`FULLSTACK_E2E.adminEmail`）——收件箱访问要求 `canTriage`
 * （`domain/feedback/product-feedback.ts`），同 `inbox-smoke.spec.ts`/
 * `feedback-drafts-smoke.spec.ts` 的既有纪律，非管理员会落在 `denied`/仅见「拒绝访问」态。
 *
 * 反馈种子直连 API 建（`page.request.post`，同 `inbox-smoke.spec.ts` 的 `seedFeedback`
 * 头注：不重复驱动别处已测过的提交弹层 UI，也避免并发 worker 抢同一个 `feedback-dialog`
 * 的 90s 点击超时）。
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";
import { SESSION_TOKEN_STORAGE_KEY } from "../lib/api-client";

const API = "/__fullstack_api";
const STAMP = Date.now();

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

function findInboxCard(page: Page, title: string): Locator {
  return page.locator('[data-testid^="inbox-card-"]').filter({ hasText: title });
}

/** 同 `inbox-smoke.spec.ts` 的 `seedFeedback`：直连 API 建种子反馈，不驱动提交弹层 UI。 */
async function seedFeedback(page: Page, kind: "缺陷" | "需求", title: string, detail: string): Promise<string> {
  const token = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_TOKEN_STORAGE_KEY);
  expect(token, "登录之后 localStorage 里应有 session token").toBeTruthy();
  const res = await page.request.post(`${API}/feedback`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: { kind, target: { kind: "product" }, title, detail, occurredRoute: null, appVersion: null },
  });
  expect(res.status(), "直连建种子反馈应该 201").toBe(201);
  const body = (await res.json()) as { id: string };
  return body.id;
}

/** 推送确认弹层：填一句工程注意事项、点确认，返回真实 `POST .../push` 响应。 */
async function pushToInbox(page: Page): Promise<{ status: number; inboxCode: string }> {
  await page.getByTestId("design-detail-push").click();
  const confirmDialog = page.getByTestId("design-push-confirm");
  await expect(confirmDialog).toBeVisible();
  await page.getByTestId("design-push-note").fill("推送前确认过一遍验收标准，工程排期时留意移动端安全区。");

  const pushed = page.waitForResponse(
    (r) => r.request().method() === "POST" && /\/pm-designs\/.+\/push$/.test(r.url()),
  );
  await page.getByTestId("design-push-confirm-submit").click();
  const pushResponse = await pushed;
  expect([200, 201]).toContain(pushResponse.status());

  await expect(page.getByTestId("design-push-success")).toBeVisible();
  const inboxCode = await extractInboxCode(page);
  return { status: pushResponse.status(), inboxCode };
}

/** 推送成功页把真实 `inboxCode`（`D-\d+`）写进正文——从可见文本里抠出来，供后续按编号找卡片。 */
async function extractInboxCode(page: Page): Promise<string> {
  const text = (await page.getByTestId("design-push-success").innerText()) ?? "";
  const match = text.match(/D-\d+/);
  expect(match, "推送成功页应能读到真实 D- 编号").not.toBeNull();
  return match?.[0] ?? "";
}

test.describe("设计工作台端到端：新建/深化 → 详情 → 推送 → 收件箱", () => {
  test.describe.configure({ mode: "serial" });

  test("① 工作台直接新建 → 详情渲染 → 推送 → 收件箱出现设计方案卡片", async ({ page }) => {
    const projectName = `E2E设计工作台新建_导出历史筛选_${STAMP}`;

    await login(page, FULLSTACK_E2E.adminEmail, FULLSTACK_E2E.adminPassword);

    /* ── 新建：工作台首页「新建设计」弹层 ── */
    await page.goto("/platform-admin/design-workbench");
    await expect(page.getByTestId("design-workbench")).toBeVisible();
    await page.getByTestId("workbench-new").click();
    const dialog = page.getByTestId("project-dialog");
    await expect(dialog).toBeVisible();
    await page.getByTestId("project-dialog-name").fill(projectName);
    await page.getByTestId("project-dialog-problem").fill("每次导出都要重新选一遍时间范围，历史记录应该能直接复用。");

    const created = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().endsWith(`${API}/pm-designs`),
    );
    await page.getByTestId("project-dialog-submit").click();
    const createdResponse = await created;
    expect(createdResponse.status(), "新建设计项目应该 201").toBe(201);

    /* ── 详情：新建成功后直接跳到详情全屏页 ── */
    await expect(page).toHaveURL(/\/platform-admin\/design-workbench\/.+/);
    await expect(page.getByTestId("design-detail")).toBeVisible();
    await expect(page.getByTestId("design-detail-chat")).toBeVisible();
    await expect(page.getByTestId("design-detail-tab-canvas")).toBeVisible();
    await expect(page.getByTestId("design-detail-canvas")).toBeVisible();
    await page.getByTestId("design-detail-tab-spec").click();
    await expect(page.getByTestId("design-detail-spec")).toContainText("每次导出都要重新选一遍时间范围");
    await page.getByTestId("design-detail-tab-canvas").click();
    await expect(page.getByTestId("design-detail-canvas")).toBeVisible();

    /* ── 推送 ── */
    const { inboxCode } = await pushToInbox(page);
    expect(inboxCode, "应该拿到真实 D- 编号").toMatch(/^D-\d+$/);

    /* ── 收件箱出现设计方案 ── */
    await page.getByTestId("design-success-inbox").click();
    await expect(page).toHaveURL(/\/platform-admin\/inbox/);
    await expect(page.getByTestId("design-loop-inbox")).toBeVisible();
    const designCard = findInboxCard(page, projectName);
    await expect(designCard).toBeVisible();
    await expect(designCard).toContainText(inboxCode);
  });

  test("② 从反馈「深化」→ 详情 → 推送 → 收件箱出现设计方案 + 原反馈标「已生成」", async ({ page }) => {
    const feedbackTitle = `E2E深化设计_录音按项目筛选_${STAMP}`;
    const projectName = `E2E深化出的设计_录音筛选方案_${STAMP}`;

    await login(page, FULLSTACK_E2E.adminEmail, FULLSTACK_E2E.adminPassword);
    await seedFeedback(page, "需求", feedbackTitle, `${feedbackTitle}。现在录音列表是全组织的，想按项目筛选。`);

    await page.goto("/platform-admin/inbox");
    await expect(page.getByTestId("design-loop-inbox")).toBeVisible();
    await findInboxCard(page, feedbackTitle).click();
    const drawer = page.getByTestId("inbox-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(feedbackTitle);

    /* ── 新建（深化）：drawer 里「用 PM 设计工作台深化」 ── */
    const deepened = page.waitForResponse(
      (r) => r.request().method() === "POST" && /\/feedback\/.+\/deepen$/.test(r.url()),
    );
    await page.getByTestId("inbox-action-deepen").click();
    const deepenResponse = await deepened;
    expect(deepenResponse.status(), "深化应该 200/201").toBeGreaterThanOrEqual(200);
    expect(deepenResponse.status()).toBeLessThan(300);

    /* ── 详情：深化产生的新项目详情全屏页，带「源自反馈」标 + 关联反馈 id ── */
    await expect(page).toHaveURL(/\/platform-admin\/design-workbench\/.+/);
    await expect(page.getByTestId("design-detail")).toBeVisible();
    await expect(page.getByTestId("design-detail-linked")).toBeVisible();
    await expect(page.getByTestId("design-detail-chat")).toBeVisible();
    await expect(page.getByTestId("design-detail-tab-canvas")).toBeVisible();
    await expect(page.getByTestId("design-detail-canvas")).toBeVisible();

    // 深化产生的项目 id 就在详情页 URL 里——下面按 id 找卡片，不按位置。
    // ⚠ 曾经用 `[data-testid^="project-card-"]`.first()：`listMyProjects` 是
    //   `ORDER BY created_at ASC`，first() 拿到的是**最老**的项目（用例①刚建的那个，
    //   或上一次重跑留下的），于是改名+推送的是一个没有 `linkedFeedbackId` 的项目，
    //   原反馈的 `resolvedByDesignId` 自然永远是 null——CI 上稳定红，后端链路
    //   （deepen → pushToInbox 回写 → listFeedback → 投影）在真 Postgres 上逐步验证过是通的。
    const projectId = decodeURIComponent(page.url().split("/design-workbench/")[1]!.split(/[?#]/)[0]!);
    expect(projectId, "详情页 URL 应带项目 id").not.toBe("");

    // 深化产生的项目名不是我们随便起的（服务端按反馈内容生成），改名以便下面用固定标题找卡片。
    await page.getByTestId("design-detail-back").click();
    await expect(page.getByTestId("design-workbench")).toBeVisible();
    const projectCard = page.getByTestId(`project-card-${projectId}`);
    await expect(projectCard).toBeVisible();
    await page.getByTestId(`project-edit-${projectId}`).click();
    const editDialog = page.getByTestId("project-dialog");
    await expect(editDialog).toBeVisible();
    await page.getByTestId("project-dialog-name").fill(projectName);
    const renamed = page.waitForResponse(
      (r) => r.request().method() === "PATCH" && /\/pm-designs\/.+$/.test(r.url()),
    );
    await page.getByTestId("project-dialog-submit").click();
    const renamedResponse = await renamed;
    expect(renamedResponse.status(), "改名应该 200").toBe(200);
    await expect(editDialog).toHaveCount(0);

    const renamedCard = page.getByTestId(`project-open-${projectId}`);
    await expect(renamedCard).toBeVisible();
    await expect(renamedCard).toContainText(projectName);
    await renamedCard.click();
    await expect(page.getByTestId("design-detail")).toBeVisible();

    /* ── 推送 ── */
    const { inboxCode } = await pushToInbox(page);
    expect(inboxCode, "应该拿到真实 D- 编号").toMatch(/^D-\d+$/);

    /* ── 收件箱出现设计方案 ── */
    await page.getByTestId("design-success-inbox").click();
    await expect(page).toHaveURL(/\/platform-admin\/inbox/);
    await expect(page.getByTestId("design-loop-inbox")).toBeVisible();
    const designCard = findInboxCard(page, projectName);
    await expect(designCard).toBeVisible();
    await expect(designCard).toContainText(inboxCode);

    /* ── 原反馈标「已生成」──：原反馈卡片上出现「已生成方案」标；drawer 里也能跳回该方案 ── */
    const feedbackCard = findInboxCard(page, feedbackTitle);
    await expect(feedbackCard).toBeVisible();
    await expect(feedbackCard.locator('[data-testid^="link-generated-"]')).toBeVisible();
    await expect(feedbackCard.locator('[data-testid^="link-generated-"]')).toContainText("已生成方案");

    await feedbackCard.click();
    const feedbackDrawer = page.getByTestId("inbox-drawer");
    await expect(feedbackDrawer).toBeVisible();
    await expect(feedbackDrawer).toContainText(feedbackTitle);
    await expect(page.getByTestId("inbox-action-open-design")).toBeVisible();

    // 刷新页面确认「已生成」不是本地乐观值，是服务端持久化的双向关联。
    await page.reload();
    await expect(page.getByTestId("design-loop-inbox")).toBeVisible();
    const feedbackCardAfterReload = findInboxCard(page, feedbackTitle);
    await expect(feedbackCardAfterReload.locator('[data-testid^="link-generated-"]')).toBeVisible();

    /* ── B3.7：关联标可点击——反馈 drawer 里点「已生成方案」→ drawer 换成设计条目 + 目标卡片高亮 + URL 带 ?open ── */
    await feedbackCardAfterReload.click();
    const drawerBeforeJump = page.getByTestId("inbox-drawer");
    await expect(drawerBeforeJump).toContainText(feedbackTitle);
    await drawerBeforeJump.locator('[data-testid^="link-generated-"]').click();
    // 高亮只持续约 1.8s，先断它（紧跟点击），再断 drawer / URL。
    await expect(page.getByTestId(`inbox-card-${inboxCode}`)).toHaveAttribute("data-highlighted", "true");
    const designDrawer = page.getByTestId("inbox-drawer");
    await expect(designDrawer).toContainText(projectName);
    // 「换成了设计条目」的判据：aria-label 以 D- 编号开头 + 有「源自反馈」标、没有「已生成方案」标。
    // ⚠ 不能断 `not.toContainText(feedbackTitle)`：深化出的设计 body = 反馈正文，正文以反馈标题开头。
    await expect(designDrawer).toHaveAttribute("aria-label", new RegExp(`^${inboxCode} `));
    await expect(designDrawer.locator('[data-testid^="link-from-"]')).toBeVisible();
    await expect(designDrawer.locator('[data-testid^="link-generated-"]')).toHaveCount(0);
    // 目标 = 设计条目，其 `id` 就是 `design_projects.id`（详情页 URL 里那个）；URL 同步成 `?open=<id>`。
    await expect(page).toHaveURL(new RegExp(`[?&]open=${encodeURIComponent(projectId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    // 反向：设计 drawer 里点「源自反馈」跳回原反馈。
    await designDrawer.locator('[data-testid^="link-from-"]').click();
    await expect(page.getByTestId("inbox-drawer")).toContainText(feedbackTitle);
  });
});
