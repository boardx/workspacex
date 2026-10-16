/** Explicit triage entry submits once and opens the persisted server feedback ID. Existing entries keep mine. */
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
  await expect(page).toHaveURL(/\/home$/);
}

function findInboxCard(page: Page, title: string): Locator {
  return page.locator('[data-testid^="inbox-card-"]').filter({ hasText: title });
}

/**
 * 直连 API 建一条反馈——同 `blueprint-contract-gap-audit.spec.ts` 的规矩：`page.request`
 * 不会自动带上身份，token 由页面存进 localStorage 里手动取。
 *
 * ⚠ 用例②③要的是"收件箱里已经有一条反馈"这个**前置状态**，不是重新验证提交弹层本身
 * ——那条链路已经被 `feedback-loop-smoke.spec.ts` 和 `feedback-drafts-smoke.spec.ts` ①
 * 覆盖过。CI 实测：两条用例都走 UI 弹层建种子数据时，与另一个 worker 并发打开同一个
 * 反馈弹层会撞上 90s 都等不到的 `feedback-kind-*` 点击超时（`fullstack-smoke` 单进程
 * Next dev server 下两个浏览器实例同时抢 CPU/事件循环）——改直连 API 建种子数据，
 * 不再驱动这段已经被别处测过的 UI，顺带把这个并发窗口关掉。
 */
async function seedFeedback(page: Page, kind: "缺陷" | "需求", title: string, detail: string): Promise<void> {
  const token = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_TOKEN_STORAGE_KEY);
  expect(token, "登录之后 localStorage 里应有 session token").toBeTruthy();
  const res = await page.request.post(`${API}/feedback`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: { kind, target: { kind: "product" }, title, detail, occurredRoute: null, appVersion: null },
  });
  expect(res.status(), "直连建种子反馈应该 201").toBe(201);
}

test.describe("统一收件箱端到端：直接提交、看板拖拽迁移、不做需理由", () => {
  test.describe.configure({ mode: "serial" });

  test("① 直接提交反馈 → 跳转收件箱并自动打开该条详情 drawer", async ({ page }) => {
    const title = `E2E收件箱直提_期望能看导出历史_${STAMP}`;
    await login(page, FULLSTACK_E2E.adminEmail, FULLSTACK_E2E.adminPassword);
    await page.goto("/platform-admin/inbox");
    await page.getByTestId("inbox-new-feedback").click();
    await expect(page.getByTestId("feedback-form")).toBeVisible();
    await expect(page.getByTestId("feedback-dialog-title")).toHaveText("对产品提反馈");
    // #2683 表单渐进展示：compose（只有详细说说+语音）→「下一步」→ review（这时才有
    // kind/标题/结构化字段/提交）——同 feedback-drafts-smoke.spec.ts①、
    // feedback-loop-smoke.spec.ts 的既有纪律。
    await page.getByTestId("feedback-detail-input").fill(`${title}。每次导出都要重新选一遍时间范围，历史记录应该能直接复用。`);
    await page.getByTestId("feedback-proceed-review").click();
    await expect(page.getByTestId("feedback-kind-需求")).toBeVisible();
    await page.getByTestId("feedback-kind-需求").click();

    let submitCount = 0;
    page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith(`${API}/feedback`)) submitCount += 1; });
    const submitted = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().endsWith(`${API}/feedback`),
    );
    await page.getByTestId("feedback-submit").click();
    const submitResponse = await submitted;
    expect(submitResponse.status(), "提交应该 201").toBe(201);

    const { feedbackId } = await submitResponse.json() as { feedbackId: string };
    expect(feedbackId).toBeTruthy();
    await expect(page).toHaveURL(new RegExp(`/platform-admin/inbox\\?open=${encodeURIComponent(feedbackId)}$`));
    const drawer = page.getByTestId("inbox-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(title);
    expect(new URL(page.url()).searchParams.get("open")).toBe(feedbackId);
    await page.reload();
    await expect(page.getByTestId("inbox-drawer")).toContainText(title);
    expect(new URL(page.url()).searchParams.get("open")).toBe(feedbackId);
    expect(submitCount).toBe(1);
  });

  test("①b 已真实保存但收件箱读取失败，保留ID和回看路径且不重发", async ({ page }) => {
    await login(page, FULLSTACK_E2E.adminEmail, FULLSTACK_E2E.adminPassword);
    await page.goto("/platform-admin/inbox");
    await page.getByTestId("inbox-new-feedback").click();
    await page.getByTestId("feedback-detail-input").fill(`E2E保存后读取失败_${STAMP}。保留已保存编号。`);
    await page.getByTestId("feedback-proceed-review").click();
    await expect(page.getByTestId("feedback-submit")).toBeVisible();
    // Fault only the destination read; the POST below reaches the actual API/database.
    await page.route(`**${API}/inbox**`, async (route) => {
      if (route.request().method() === "GET") await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "service_unavailable" }) });
      else await route.continue();
    });
    let submits = 0;
    page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith(`${API}/feedback`)) submits += 1; });
    const response = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`${API}/feedback`));
    await page.getByTestId("feedback-submit").click();
    const saved = await response;
    expect(saved.status()).toBe(201);
    const { feedbackId } = await saved.json() as { feedbackId: string };
    const notice = page.getByTestId("inbox-saved-open-failed");
    await expect(notice).toContainText("已保存，无法打开收件箱");
    await expect(notice).toContainText(feedbackId);
    await expect(notice.getByRole("link")).toHaveAttribute("href", `/platform-admin/inbox?open=${encodeURIComponent(feedbackId)}`);
    await page.getByTestId("inbox-retry").click();
    await expect(notice).toBeVisible();
    expect(submits).toBe(1);
    await page.unroute(`**${API}/inbox**`);
    await page.getByTestId("inbox-retry").click();
    await expect(page.getByTestId("inbox-drawer")).toContainText(`E2E保存后读取失败_${STAMP}`);
    expect(submits).toBe(1);
  });

  test("② 看板拖拽换状态触发真实 API 迁移，刷新后仍是新状态", async ({ page }) => {
    const title = `E2E收件箱拖拽_批注同步慢_${STAMP}`;
    // 用第一条用例的账号先真实提交一条反馈作为拖拽对象（不依赖用例①的跳转是否生效——
    // 这里显式手动导航到收件箱，两条用例互不依赖对方的断言成立与否）。种子数据直连
    // API 建（见 `seedFeedback` 头注：不重复驱动别处已测过的提交弹层 UI）。
    await login(page, FULLSTACK_E2E.adminEmail, FULLSTACK_E2E.adminPassword);
    await seedFeedback(page, "缺陷", title, `${title}。批注写完之后要等好几秒才在别人那边出现。`);

    await page.goto("/platform-admin/inbox");
    await expect(page.getByTestId("design-loop-inbox")).toBeVisible();
    await expect(page.getByTestId("inbox-view-board")).toHaveAttribute("aria-pressed", "true");

    const backlogColumn = page.getByTestId("inbox-column-backlog");
    const doingColumn = page.getByTestId("inbox-column-doing");
    await expect(backlogColumn.locator('[data-testid^="inbox-card-"]').filter({ hasText: title })).toBeVisible();

    const card = findInboxCard(page, title);
    // BoardCard 是原生 `draggable`（`components/design-loop/inbox-screen.tsx` `BoardCard`：
    // `draggable={!busy}` + `onDragStart` 用 `dataTransfer.setData`，列容器 `onDragOver`/
    // `onDrop` 读 `dataTransfer.getData`）——标准 HTML5 拖放，Playwright 的 `dragTo` 用真实
    // 鼠标事件驱动浏览器原生 DnD，直接能用，不需要退回手动 dispatchEvent(dragstart/…/drop) 序列。
    //
    // ⚠ 2026-09-05 起「转入开发」与建 GitHub issue 绑定（见 `inbox-screen.tsx` 头注）：这条
    //   反馈还没有 issue，拖进「进行中」不直接乐观挪列 / 发请求，而是打开 drawer 的 issue
    //   确认表单——同 `feedback-loop-smoke.spec.ts` 的顺序纪律，这里提交那份表单才是真正
    //   触发 `triageFeedback` 的动作。`fullstack-smoke` 环境故意不配 `GITHUB_ISSUE_TOKEN`，
    //   建 issue fail closed，如实拿到 503、状态留在「待处理」——这正是要断言的真实行为，
    //   不是把这条用例改弱。
    await card.dragTo(doingColumn);
    const drawer = page.getByTestId("inbox-drawer");
    await expect(drawer).toBeVisible();
    const issueSubmit = drawer.getByTestId("inbox-issue-submit");
    await expect(issueSubmit).toBeVisible();
    const hasGithubToken = Boolean(process.env.GITHUB_ISSUE_TOKEN);
    const triaged = page.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url().includes(`${API}/feedback`),
    );
    await issueSubmit.click();
    const triagedResponse = await triaged;
    expect(triagedResponse.status()).toBe(hasGithubToken ? 200 : 503);
    await page.getByTestId("inbox-drawer-close").click();

    await page.reload();
    await expect(page.getByTestId("design-loop-inbox")).toBeVisible();
    const doingColumnAfterReload = page.getByTestId("inbox-column-doing");
    const backlogColumnAfterReload = page.getByTestId("inbox-column-backlog");
    if (hasGithubToken) {
      await expect(doingColumnAfterReload.locator('[data-testid^="inbox-card-"]').filter({ hasText: title })).toBeVisible();
      await expect(backlogColumnAfterReload.locator('[data-testid^="inbox-card-"]').filter({ hasText: title })).toHaveCount(0);
    } else {
      // 建 issue 失败 ⇒ fail closed，状态如实留在「待处理」（未配 token 的本环境预期分支）。
      await expect(backlogColumnAfterReload.locator('[data-testid^="inbox-card-"]').filter({ hasText: title })).toBeVisible();
      await expect(doingColumnAfterReload.locator('[data-testid^="inbox-card-"]').filter({ hasText: title })).toHaveCount(0);
    }
  });

  test("③ 转「不做」需要理由：不填不让确认，填了才能确认，理由随状态一起可见", async ({ page }) => {
    const title = `E2E收件箱不做_想要暗色主题切换_${STAMP}`;
    await login(page, FULLSTACK_E2E.adminEmail, FULLSTACK_E2E.adminPassword);
    // 种子数据直连 API 建（见 `seedFeedback` 头注）。
    await seedFeedback(page, "需求", title, `${title}。晚上用的时候太亮了，想要一个暗色主题。`);

    await page.goto("/platform-admin/inbox");
    await expect(page.getByTestId("design-loop-inbox")).toBeVisible();
    await findInboxCard(page, title).click();
    const drawer = page.getByTestId("inbox-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(title);

    await page.getByTestId("inbox-action-decline").click();
    const declineForm = page.getByTestId("inbox-decline-form");
    await expect(declineForm).toBeVisible();

    // 理由为空——确认按钮不可用（`canConfirm = reason.trim() !== ""`，`inbox-decline-confirm` disabled）。
    const confirmButton = page.getByTestId("inbox-decline-confirm");
    await expect(confirmButton).toBeDisabled();
    await expect(page.getByTestId("err-reason")).toBeVisible();

    const declineReason = "暗色主题涉及全站配色系统，纳入下季度设计系统改造一并做，不单独排期";
    await page.getByTestId("inbox-decline-reason").fill(declineReason);
    await expect(confirmButton).toBeEnabled();
    await expect(page.getByTestId("err-reason")).toHaveCount(0);

    const declined = page.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url().includes(`${API}/feedback`),
    );
    await confirmButton.click();
    const declinedResponse = await declined;
    expect(declinedResponse.status(), "转不做应该 200").toBe(200);

    // 状态变为「不做」（archived 阶段），理由在详情里可见。
    await expect(drawer.locator('[data-testid="status-badge-archived"]')).toBeVisible();
    await expect(page.getByTestId("inbox-drawer-reason")).toContainText(declineReason);

    // 刷新页面确认理由与状态都是服务端持久化的，不是本地乐观值。
    await page.reload();
    await expect(page.getByTestId("design-loop-inbox")).toBeVisible();
    await findInboxCard(page, title).click();
    const drawerAfterReload = page.getByTestId("inbox-drawer");
    await expect(drawerAfterReload.locator('[data-testid="status-badge-archived"]')).toBeVisible();
    await expect(page.getByTestId("inbox-drawer-reason")).toContainText(declineReason);
  });
});
