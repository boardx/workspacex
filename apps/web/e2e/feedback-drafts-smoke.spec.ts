/**
 * UC-17.8 B1.6 —— 反馈草稿端到端：存草稿 → 草稿列表可见 → 「继续完善」首次自动追加
 * AI 澄清问题 → 追加一轮对话（服务端固定回执）→ 提交到收件箱 → 草稿从列表消失 →
 * 该条最终在收件箱里、状态「待处理」。
 *
 * ## ⚠ CI 实测推翻了本文件原先「不需要跨账号」的假设——现在拆两个身份
 *
 * 原先设想：草稿是 per-user 私有资源，一个身份（`email`，consultant）就能跑完整条链路，
 * 不需要像 D3 反证那样切管理员。**这个假设是错的**：`canTriage`（`domain/feedback/
 * product-feedback.ts`）把收件箱访问收紧到 `orgRole === "admin"`；而草稿提交成功后的
 * 默认导航（`design-loop-screens.tsx` `FeedbackDraftsScreen.onSubmitted` → `/platform-
 * admin/inbox?open=<feedbackId>`，Sprint 1 既有行为，本文件未改动它）**不看提交人是不
 * 是管理员就跳**。所以一个非管理员账号存草稿、提交后落地在收件箱页，看到的**如实**是
 * 「运营收件箱仅平台运营可见」（`data-testid="denied"`），不是收件箱内容——这不是这次
 * 才引入的新行为，是已合入 main 的既有行为第一次被端到端跑到。
 *
 * 这与 `inbox-smoke.spec.ts` 用例①（直接提交自动跳收件箱开 drawer）标 `test.fixme` 是
 * **同一个根因**：`FeedbackDialog`/草稿提交都会把非管理员导向一个他大概率无权访问的
 * 后台路由。已在 backlog 待确认清单里把两处合并成一条决策（哪些入口该跳、要不要按角色
 * 分流），不在本文件里替产品做决定。本文件的断言只如实反映**当前代码的真实行为**：
 * ① 非管理员提交人被导到收件箱后看到「拒绝访问」提示；② 换管理员身份登录后，
 * 这条反馈确实在收件箱里、状态「待处理」——证明数据链路是通的，只是前端导航目标
 * 需要人类拍板。
 *
 * ## 「继续完善」首次自动追加澄清问题——发生在**发送第一条消息之后**，不是打开浮层那一刻
 *
 * `updateFeedbackDraft`（`apps/api/src/application/feedback/drafts/update-feedback-draft.ts`）
 * 的 seed 逻辑挂在 `appendChat` 分支上：`refineSeeded === false` 时，服务端先追加固定的
 * `REFINE_SEED_QUESTION`，再追加这次的用户消息，再追加固定回执 `REFINE_ACK`——三条一次性
 * 写回。所以浮层刚打开、用户还没发第一句话时 `draft.chat` 仍是空的（`draft-refine-chat-empty`
 * 可见）；发出第一条消息之后，一次 PATCH 换回三轮对话。这里按服务端真实时序断言，不臆造
 * 「打开就有澄清问题」这个前端从未实现过的行为。
 *
 * ## 两个身份怎么串：不跨 test() 传变量，靠 `STAMP` 标题找
 *
 * `test.describe.configure({mode:"serial"})` 保留顺序，但不同 `test()` 各有一个全新
 * `page`（Playwright 默认），所以第二条用例不读第一条的内存变量，靠模块级 `DRAFT_TITLE`
 * （嵌了 `STAMP`）在收件箱里搜——同 `feedback-loop-smoke.spec.ts` 已验证过的既有手法。
 */
import { expect, test, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

const API = "/__fullstack_api";
const STAMP = Date.now();
const DRAFT_TITLE = `E2E草稿_录音列表筛选_${STAMP}`;
const DRAFT_DETAIL = `${DRAFT_TITLE}。现在录音列表是全组织的，找上周那场要翻很久，希望能按项目筛选。`;
const REFINE_MESSAGE = "只影响我们团队自己的项目视图，优先级不高，下个季度做也可以。";

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

test.describe("反馈草稿端到端：存草稿到提交进收件箱", () => {
  test.describe.configure({ mode: "serial" });

  test("① 非管理员：存草稿 → 草稿列表可见 → 继续完善（首次自动追加澄清问题）→ 追加对话 → 提交 → 从列表消失、导航到收件箱后如实显示「仅平台运营可见」", async ({ page }) => {
    await login(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);

    /* ── 存草稿：图标栏「反馈」入口，先填正文（compose 阶段），点「下一步」进入
       review 阶段才有 kind/标题/结构化字段/存为草稿——#2683 表单渐进展示改的两段式
       流程（`feedback-dialog.tsx` `stage: "compose" | "review"`），本文件之前的版本
       还按旧的单段式（kind 按钮直接在 compose 阶段可点）写，CI 实测三轮排查最后
       定位到：`harness-verify.yml` 用 `refs/pull/<N>/merge` 跑，main 早已带着这次
       重构合并，旧断言在 merge-ref 上必然点不到已经不存在的按钮。 ── */
    await page.getByTestId("rail-feedback").click();
    await expect(page.getByTestId("feedback-form")).toBeVisible();
    await expect(page.getByTestId("feedback-dialog-title")).toHaveText("对产品提反馈");
    await page.getByTestId("feedback-detail-input").fill(DRAFT_DETAIL);
    await page.getByTestId("feedback-proceed-review").click();
    // AI 整理（`structureFeedbackDraft`）这个 e2e 环境没配真实模型，稳定失败、
    // 静默退回 `deriveFeedbackTitle` 兜底——不影响进入 review、也不影响标题最终
    // 是 DRAFT_DETAIL 的第一句（= DRAFT_TITLE，见下方断言）。
    await expect(page.getByTestId("feedback-kind-需求")).toBeVisible();
    await page.getByTestId("feedback-kind-需求").click();

    const draftSaved = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().endsWith(`${API}/feedback/drafts`),
    );
    await page.getByTestId("feedback-save-draft").click();
    const draftResponse = await draftSaved;
    expect(draftResponse.status(), "存草稿应该 201").toBe(201);

    // 存草稿成功后弹层默认行为：关闭并跳到 `/platform-admin/feedback-drafts`
    // （`feedback-dialog.tsx` `saveDraft()`：无 `onDraftSaved` 回调时 `onClose()` + `router.push`）。
    await expect(page).toHaveURL(/\/platform-admin\/feedback-drafts$/);
    await expect(page.getByTestId("design-loop-drafts")).toBeVisible();

    /* ── 草稿列表可见 ── */
    const draftList = page.getByTestId("drafts-list");
    await expect(draftList).toBeVisible();
    await expect(draftList).toContainText(DRAFT_TITLE);
    const draftCard = page.locator('[data-testid^="draft-card-"]').filter({ hasText: DRAFT_TITLE });
    await expect(draftCard).toBeVisible();

    /* ── 打开「继续完善」：浮层刚打开时对话为空（首次澄清问题挂在**发送**这一刻，不是打开这一刻） ── */
    const refineButton = draftCard.locator('[data-testid^="draft-refine-"]');
    await refineButton.click();
    const overlay = page.getByTestId("draft-refine-overlay");
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText(DRAFT_TITLE);
    await expect(page.getByTestId("draft-refine-chat-empty")).toBeVisible();

    /* ── 追加一轮对话：发第一条消息 → 服务端一次性追加「AI 澄清问题 → 用户消息 → AI 固定回执」三轮 ── */
    const firstAppend = page.waitForResponse(
      (r) => r.request().method() === "PATCH" && /\/feedback\/drafts\/[^/]+$/.test(r.url()),
    );
    await page.getByTestId("draft-refine-input").fill(REFINE_MESSAGE);
    await page.getByTestId("draft-refine-send").click();
    const firstAppendResponse = await firstAppend;
    expect(firstAppendResponse.status(), "追加对话应该 200").toBe(200);

    const chat = page.getByTestId("draft-refine-chat");
    await expect(page.getByTestId("draft-refine-chat-empty")).toHaveCount(0);
    // D7：固定文案，不接模型——服务端唯一事实源在 `update-feedback-draft.ts` 的
    // `REFINE_SEED_QUESTION`/`REFINE_ACK`，这里不复述其原文，只断言角色/顺序。
    const turns = chat.locator('[data-testid^="draft-refine-turn-"]');
    await expect(turns).toHaveCount(3);
    await expect(turns.nth(0)).toHaveAttribute("data-testid", "draft-refine-turn-ai-message");
    await expect(turns.nth(1)).toHaveAttribute("data-testid", "draft-refine-turn-user-message");
    await expect(turns.nth(1)).toContainText(REFINE_MESSAGE);
    await expect(turns.nth(2)).toHaveAttribute("data-testid", "draft-refine-turn-ai-message");

    /* ── 提交到收件箱：浮层里「准备好，提交到收件箱」 ── */
    const submitted = page.waitForResponse(
      (r) => r.request().method() === "POST" && /\/feedback\/drafts\/[^/]+\/submit$/.test(r.url()),
    );
    await page.getByTestId("draft-refine-submit").click();
    const submitResponse = await submitted;
    // 201：同 `POST /feedback`，这条路由创建了一行反馈资源（见
    // `feedback.controller.ts` submitDraft 的 `@HttpCode(HttpStatus.CREATED)`）。
    expect(submitResponse.status(), "提交草稿应该 201").toBe(201);
    const submitBody = (await submitResponse.json()) as { feedbackId?: string };
    expect(submitBody.feedbackId, "提交应返回真实的 feedbackId").toBeTruthy();

    /* ── 提交后自动跳到 `/platform-admin/inbox?open=<feedbackId>`（Sprint 1 既有导航，
       本文件未改动它）——但提交人是非管理员，`canTriage` 只放行 admin，所以这里如实
       看到的是拒绝访问提示，不是收件箱内容。见文件头注：这与 inbox-smoke.spec.ts 用例①
       是同一个待人类裁决的产品决策，不在测试里假装成收件箱可见来迁就旧断言。 ── */
    await expect(page).toHaveURL(/\/platform-admin\/inbox\?open=/);
    await expect(page.getByTestId("denied")).toBeVisible();
    await expect(page.getByTestId("denied")).toContainText("仅平台运营可见");

    // 回到草稿列表页确认这条真的从「反馈草稿」里消失了（不是只在收件箱那一侧看得见）。
    await page.goto("/platform-admin/feedback-drafts");
    await expect(page.getByTestId("design-loop-drafts")).toBeVisible();
    const remainingDrafts = page.locator('[data-testid^="draft-card-"]').filter({ hasText: DRAFT_TITLE });
    await expect(remainingDrafts).toHaveCount(0);
  });

  test("② 管理员：这条反馈确实落在收件箱、状态待处理（证明数据链路是通的）", async ({ page }) => {
    await login(page, FULLSTACK_E2E.adminEmail, FULLSTACK_E2E.adminPassword);
    await page.goto("/platform-admin/inbox");
    await expect(page.getByTestId("design-loop-inbox")).toBeVisible();

    await page.getByTestId("inbox-search").fill(DRAFT_TITLE);
    const card = page.locator('[data-testid^="inbox-card-"]').filter({ hasText: DRAFT_TITLE });
    await expect(card).toBeVisible();
    await card.click();

    const drawer = page.getByTestId("inbox-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(DRAFT_TITLE);
    // 待处理 = `backlog` 阶段（`INBOX_STAGE_LABEL.backlog === "待处理"`）。
    await expect(drawer.locator('[data-testid="status-badge-backlog"]')).toBeVisible();
    await expect(drawer).toContainText("待处理");
  });
});
