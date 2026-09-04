/**
 * UC-17.8 B1.6 —— 反馈草稿端到端：存草稿 → 草稿列表可见 → 「继续完善」首次自动追加
 * AI 澄清问题 → 追加一轮对话（服务端固定回执）→ 提交到收件箱 → 草稿从列表消失 →
 * 该条在 `/platform-admin/inbox` 可见且状态为「待处理」。
 *
 * ## 为什么只用一个身份、一条链路（不像 F48/F49 要证明多种 `FeedbackTarget`）
 *
 * B1（草稿）这条线本身不判别 `FeedbackTarget` 的三种分支——草稿的存在与「继续完善」
 * 对话轨迹跟提交对象是产品还是 skill/agent 无关，那条判别已经由
 * `feedback-loop-smoke.spec.ts` 覆盖过。这里要证明的是**草稿自己的生命周期**：
 * 存 → 列表 → 编辑对话 → 提交 → 从草稿消失同时出现在收件箱，一条真实链路即可，
 * 不需要再重复四种目标组合。
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
 * ## 复用 `fullstack-smoke-fixture.ts` 现成的引导师账号，不新种隔离账号
 *
 * 草稿是 per-user 私有资源（RLS owner-only），`email`（facilitator）这一个身份已经足够
 * 跑完整条链路，不需要像 D3 反证那样跨账号。
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

  test("存草稿 → 草稿列表可见 → 继续完善（首次自动追加澄清问题）→ 追加对话 → 提交到收件箱 → 从列表消失、收件箱可见且待处理", async ({ page }) => {
    await login(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);

    /* ── 存草稿：图标栏「反馈」入口，填正文，点「存为草稿」 ── */
    await page.getByTestId("rail-feedback").click();
    await expect(page.getByTestId("feedback-form")).toBeVisible();
    await page.getByTestId("feedback-kind-需求").click();
    await page.getByTestId("feedback-detail-input").fill(DRAFT_DETAIL);

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

    /* ── 草稿从列表消失、自动跳到收件箱并展开这条详情（`onSubmitted` → `/platform-admin/inbox?open=<feedbackId>`） ── */
    await expect(page).toHaveURL(/\/platform-admin\/inbox\?open=/);
    await expect(page.getByTestId("design-loop-inbox")).toBeVisible();
    const drawer = page.getByTestId("inbox-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(DRAFT_TITLE);
    // 待处理 = `backlog` 阶段（`INBOX_STAGE_LABEL.backlog === "待处理"`）。
    await expect(drawer.locator('[data-testid="status-badge-backlog"]')).toBeVisible();
    await expect(drawer).toContainText("待处理");

    // 回到草稿列表页确认这条真的从「反馈草稿」里消失了（不是只在收件箱那一侧看得见）。
    await page.goto("/platform-admin/feedback-drafts");
    await expect(page.getByTestId("design-loop-drafts")).toBeVisible();
    const remainingDrafts = page.locator('[data-testid^="draft-card-"]').filter({ hasText: DRAFT_TITLE });
    await expect(remainingDrafts).toHaveCount(0);
  });
});
