/**
 * UC-17.8 B3.8 —— 统一收件箱端到端：直接提交自动开 drawer、看板拖拽触发真实状态迁移、
 * 「不做」需要理由。
 *
 * ## ⚠ 用例①标为 `fixme`——不是缺口，是与已签核行为的真实冲突
 *
 * `uc-17-8-研发闭环-反馈到设计到排期.md` R4.1 写「直接提交 → 跳转收件箱并自动打开该条
 * 详情 drawer」，但这与**已签核** `feedback-loop` 束 UC-F1 第 6 步矛盾：「弹层自动切到
 * 「我提过的」，刚提交那条排在第一行」——`feedback-dialog.tsx` 的 `send()` 今天实现的
 * 正是后者（已签核行为），不是前者。
 *
 * 更关键的是：`FeedbackDialog` 是**同一个组件**，同时服务图标栏入口、chat 内 agent 消息
 * 反馈按钮、chat 内 skill chip 反馈按钮——后两者的调用者是**任意组织成员**，不是只有
 * PM/运营。若无条件把直接提交后的默认行为改成跳 `/platform-admin/inbox`，一个普通成员
 * 在 chat 里对某条 AI 回复提反馈后会被强制跳到一个他大概率没有权限访问的后台路由——
 * 这是比"跳转没做"更糟的回归，不是简单地把 R4.1 抄进代码就对。
 *
 * 这是需要人类确认的产品决策（哪些入口该跳、要不要拆分组件行为），已记入
 * `uc-17-8-go-live-backlog.md` 待确认清单，不由 agent 自行决定。用 `test.fixme` 而不是
 * 直接删除或强行改断言迁就现状：断言仍按 R4.1 原文写，留作决策落地后的验收标准。
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

  // 见文件头——与已签核 `feedback-loop` UC-F1 行为冲突，且涉及 chat 内非管理员入口的
  // 权限影响，是待人类裁决的产品决策，不是可以顺手补的缺口。`test.fixme` 使其跳过而非红。
  test.fixme("① 直接提交反馈 → 跳转收件箱并自动打开该条详情 drawer", async ({ page }) => {
    const title = `E2E收件箱直提_期望能看导出历史_${STAMP}`;
    await login(page, FULLSTACK_E2E.adminEmail, FULLSTACK_E2E.adminPassword);
    await page.getByTestId("rail-feedback").click();
    await expect(page.getByTestId("feedback-form")).toBeVisible();
    await expect(page.getByTestId("feedback-dialog-title")).toHaveText("对产品提反馈");
    // #2683 表单渐进展示：compose（只有详细说说+语音）→「下一步」→ review（这时才有
    // kind/标题/结构化字段/提交）——同 feedback-drafts-smoke.spec.ts①、
    // feedback-loop-smoke.spec.ts 的既有纪律。
    await page.getByTestId("feedback-detail-input").fill(`${title}。每次导出都要重新选一遍时间范围，历史记录应该能直接复用。`);
    await page.getByTestId("feedback-proceed-review").click();
    await expect(page.getByTestId("feedback-kind-需求")).toBeVisible();
    await page.getByTestId("feedback-kind-需求").click();

    const submitted = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().endsWith(`${API}/feedback`),
    );
    await page.getByTestId("feedback-submit").click();
    const submitResponse = await submitted;
    expect(submitResponse.status(), "提交应该 201").toBe(201);

    // 需求原文行为：提交后自动跳到 `/platform-admin/inbox?open=<feedbackId>` 并展开这条详情。
    // 见文件头——待人类就"哪些入口该跳"裁决后再启用本用例。
    await expect(page).toHaveURL(/\/platform-admin\/inbox\?open=/);
    const drawer = page.getByTestId("inbox-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(title);
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
    const triaged = page.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url().includes(`${API}/feedback`),
    );
    await card.dragTo(doingColumn);
    const triagedResponse = await triaged;
    expect(triagedResponse.status(), "拖拽应触发 triageFeedback 200").toBe(200);

    // 乐观更新已经把卡片挪到「进行中」列——先确认这一步，再刷新页面确认落库不是本地乐观值。
    await expect(doingColumn.locator('[data-testid^="inbox-card-"]').filter({ hasText: title })).toBeVisible();
    await expect(backlogColumn.locator('[data-testid^="inbox-card-"]').filter({ hasText: title })).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId("design-loop-inbox")).toBeVisible();
    const doingColumnAfterReload = page.getByTestId("inbox-column-doing");
    const backlogColumnAfterReload = page.getByTestId("inbox-column-backlog");
    await expect(doingColumnAfterReload.locator('[data-testid^="inbox-card-"]').filter({ hasText: title })).toBeVisible();
    await expect(backlogColumnAfterReload.locator('[data-testid^="inbox-card-"]').filter({ hasText: title })).toHaveCount(0);
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
