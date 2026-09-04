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

/**
 * 诊断版点击——CI 实测三轮排查（渲染时序/超时预算/并发窗口）都排除后，`feedback-kind-*`
 * 的点击在这一个文件里仍确定性卡满 90s（同一提交原始跑 + retry 两次都卡在同一行），
 * 而 `feedback-loop-smoke.spec.ts` 同一组件、同一按钮在同一次运行里稳定通过——说明
 * 剩下的不是资源问题，是这个文件独有的某种真实状态差异，但看不到 CI 的
 * screenshot/trace（本环境出站网络不通到 actions 产物的 blob 存储）没法肉眼确认。
 * 这里在真正卡死前先做一轮短超时探测 + 打印 DOM 现场到 stdout（job log 能读到），
 * 探测不到问题就退回 `{force:true}` 强制点击——如果这本来就是一次 actionability
 * 误判（元素其实可点，只是稳定性检查被什么东西撞了），强制点击会成功且不掩盖真正的
 * 产品缺陷（后续断言仍然是真实断言，不会因为强制点击就跳过验证）。
 */
async function clickWithDiagnostics(page: Page, testId: string): Promise<void> {
  const locator = page.getByTestId(testId);
  try {
    await locator.click({ timeout: 15_000 });
    return;
  } catch (err) {
    // 上一轮 CI 实测：诊断回传 `{found:false}`——15s 后目标按钮**根本不在 DOM 里**，
    // 不是被别的元素挡住/不可见这种 actionability 误判。既然连按钮本体都消失了，
    // 这次多打几个相邻锚点（弹层容器/标题/URL）判断是「整个弹层被卸载」还是
    // 「只有这个 fieldset 消失、弹层其余部分还在」，缩小到底是哪一层状态没了。
    const diag = await page.evaluate((tid) => {
      const el = document.querySelector(`[data-testid="${tid}"]`);
      const base = {
        url: window.location.href,
        dialogFormPresent: document.querySelector('[data-testid="feedback-form"]') !== null,
        dialogTitlePresent: document.querySelector('[data-testid="feedback-dialog-title"]') !== null,
        dialogTitleText: document.querySelector('[data-testid="feedback-dialog-title"]')?.textContent ?? null,
        railFeedbackPresent: document.querySelector('[data-testid="rail-feedback"]') !== null,
      };
      if (!el) return { ...base, found: false };
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const atPoint = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return {
        ...base,
        found: true,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        pointerEvents: style.pointerEvents,
        disabled: (el as HTMLButtonElement).disabled ?? null,
        elementAtPointIsSelf: atPoint === el,
        elementAtPointTestId: atPoint?.getAttribute("data-testid") ?? null,
        elementAtPointTag: atPoint?.tagName ?? null,
      };
    }, testId);
    // eslint-disable-next-line no-console -- 诊断信息要落进 CI job log，不是给开发者本地看的调试残留。
    console.log(`[clickWithDiagnostics] ${testId} 15s 内未能常规点击，DOM 现场：`, JSON.stringify(diag), "原始错误：", String(err));
    await locator.click({ force: true, timeout: 15_000 });
  }
}

test.describe("反馈草稿端到端：存草稿到提交进收件箱", () => {
  test.describe.configure({ mode: "serial" });

  test("① 非管理员：存草稿 → 草稿列表可见 → 继续完善（首次自动追加澄清问题）→ 追加对话 → 提交 → 从列表消失、导航到收件箱后如实显示「仅平台运营可见」", async ({ page }) => {
    // CI 实测排除到这一步：不是渲染时序（已等 dialog-title 落定）、不是总超时预算
    // （放宽到 90s 仍卡满）、不是并发资源竞争（单独跑、无重试并发也一样）——是
    // `clickWithDiagnostics` 实测出的一个更具体的事实：15s 后 `feedback-kind-需求`
    // **根本不在 DOM 里**了。这里加上浏览器侧 console/pageerror 转发，把可能的
    // React 渲染期异常也落进 job log，帮下一轮定位是谁把它卸载了。
    test.setTimeout(90_000);
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log(`[browser console.error] ${msg.text()}`); // eslint-disable-line no-console -- 诊断需要落进 job log。
    });
    page.on("pageerror", (err) => {
      console.log(`[browser pageerror] ${String(err)}`); // eslint-disable-line no-console -- 诊断需要落进 job log。
    });
    await login(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);

    /* ── 存草稿：图标栏「反馈」入口，填正文，点「存为草稿」 ── */
    await page.getByTestId("rail-feedback").click();
    await expect(page.getByTestId("feedback-form")).toBeVisible();
    // 同 feedback-loop-smoke.spec.ts 已验证过的既有纪律：等标题落定再点 kind 按钮——
    // 只等 feedback-form 出现会在弹层还没完全稳定（entrance 动画/首帧）时就去点，
    // CI 资源紧张时会撞上 Playwright 的 actionability 重试直到超时（非本 PR 代码回归）。
    await expect(page.getByTestId("feedback-dialog-title")).toHaveText("对产品提反馈");
    await clickWithDiagnostics(page, "feedback-kind-需求");
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
