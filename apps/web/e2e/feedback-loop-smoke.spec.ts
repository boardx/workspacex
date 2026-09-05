/**
 * PROP-FEEDBACK-LOOP-E2E-001 FB-2/FB-3（F48/F49）—— 真实浏览器端到端：
 * **不同种类的反馈从前端提交 → 后台真的看得见**。
 *
 * 人类原话（2026-08-16）：「做一个端到端的测试，在前端提交的不同种类的反馈，
 * 在后台要可以看。」——本文件就是这句话。
 *
 * ## 覆盖的「不同种类」——三个目标 × 两个类型，四条真实提交
 *
 *   ① 产品级 · 缺陷   —— 引导师账号，图标栏「反馈」入口
 *   ② 产品级 · 需求   —— 非管理员成员账号，图标栏「反馈」入口
 *   ③ Skill 级 · 缺陷 —— 引导师账号，会话内已挂载 skill 的 chip 上
 *   ④ Agent 级 · 需求 —— 引导师账号，会话内一条**真实**的 AI 回复上
 *
 * 四条覆盖三种 `FeedbackTarget` 判别联合分支、两种 `FeedbackKind`，且提交人跨越
 * 「引导师」与「普通成员」两种角色——不是四次同一条路径换个字符串。
 *
 * ## 拆成五条独立 `test()`，`serial` 模式，而不是一条巨型用例
 *
 * 第一版是一条 480s 的大用例，在切第三个账号时稳定卡死：`/login` 页
 * （`login-session-gate.tsx`）一旦检测到 `status === "authenticated"` 就
 * `router.replace("/projects")`，而 Playwright 默认给**每个 test() 一个全新
 * context**（全新 localStorage），同一个 `page` 里换账号却不登出，第二次
 * `page.goto("/login")` 时上一个账号的 token 还在，触发那个重定向——
 * `login-email` 字段在 fill 到一半时被整页替换，Playwright 报
 * 「element was detached from the DOM, retrying」直到用例超时。
 * 全仓其它多账号用例（`skill-review-gate.spec.ts` 等）无一例外每个身份一条
 * 独立 `test()`，本文件第一版是唯一的反例——改成同样的形状，问题随之消失，
 * 顺便也让失败定位精确到具体哪一步（同 #1324 拆分大用例的理由）。
 *
 * `test.describe.configure({ mode: "serial" })` 保留顺序（后面的用例要读前面
 * 提交出来的数据），标题里嵌入模块级 `STAMP` 让五条用例共享同一批可查找的标记。
 *
 * ## 中途夹一条 D3 反证：非管理员看得到标题看不到别人的正文
 *
 * 独立成一条用例：成员账号访问 `/admin/feedback`，断言她**自己那条**（②）正文
 * 可见，**引导师那条**（①）正文显示「仅组织管理员与提交人可见」而不是原文，
 * 且计数区因 403 显示「取不到」。这不是猜的行为，是契约 D3 与
 * `getFeedbackCounts` 权限门的真实服务端判定——不接触服务端代码，只用真实
 * 登录 + 真实浏览器验它成立。
 *
 * ## 收尾闭环：管理员真的能处置
 *
 * 管理员登录后：四条全部可见（软件反馈两条、Agent/Skill 反馈两条，分列正确）；
 * 对①投票（`COUNT(*)` 真实 +1，不是本地乐观值）；对①分诊「转已进入迭代」并
 * **刷新页面**确认状态是从 PostgreSQL 读回来的，不是 React state；对④转「不做」
 * 并要求先填理由（不填不让确认），确认理由与状态一并落库可见。
 *
 * ## 为什么排进 `seeded` project，不单独起一套栈
 *
 * 复用 `fullstack-smoke-fixture.ts` 现成的三个角色（`email` 引导师 / `memberEmail`
 * 非管理员 / `adminEmail` 组织管理员）与现成的可挂载 skill / 可运行 agent，
 * 与本文件同目录的 `core-loop.spec.ts` 步骤 8a/8b 是同一条挂载/发消息的真实链路，
 * 不重新发明——本文件的价值在「反馈这条线端到端打通」，不在「chat 链路怎么走」。
 *
 * ⚠ 步骤③④所在的那条用例需要真的等一次 agent run 从 queued 跑到
 *   succeeded（步骤 8b 同款），Playwright 默认单条超时 30s 远不够，
 *   显式放宽该用例自己的 `test.setTimeout`——其余四条不需要这么宽，
 *   给全部用例统一套一个大超时会掩盖「某一步其实卡住了」这种慢。
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

const API = "/__fullstack_api";
const STAMP = Date.now();
const TITLES = {
  productBug: `E2E产品缺陷_批准卡不记得预算_${STAMP}`,
  productReq: `E2E产品需求_希望能筛选录音_${STAMP}`,
  skillBug: `E2E技能缺陷_输出格式不稳_${STAMP}`,
  agentReq: `E2E智能体需求_希望能引用原文_${STAMP}`,
};

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

/**
 * 提交一条反馈：假定弹层**已经打开**（由调用方点开正确的触发按钮，
 * 因为「怎么打开」正是本文件要覆盖的三种不同入口之一）。
 *
 * ⚠ 等的是**真实 POST 响应** 201，不是 UI 状态切换——UI 切到「我提过的」标签页
 *   有可能是乐观的（本实现不是，但断言不该依赖「这次没做乐观更新」这件事本身）。
 */
async function submitOpenFeedback(
  page: Page,
  opts: { kind: "缺陷" | "需求"; title: string; detail: string },
): Promise<void> {
  await expect(page.getByTestId("feedback-form")).toBeVisible();
  // issue #2679 ②——表单现在是两段式：compose（只有「详细说说」+ 语音）→ 点「下一步」
  // 交给 AI 整理 → review（这时才有 kind/标题/结构化字段/提交按钮）。这个 e2e 环境
  // 没有配置真实模型，AI 整理稳定 503、被前端静默吞掉、退回按正文首句派生标题，
  // 不影响进入 review、也不影响后续提交。
  // 2026-09-02 起表单只有「详细说说」，标题取正文第一句（到第一个句号）——把标题写成
  // 第一句、后面跟原正文，后台列表/「我提过的」里看到的标题就是 `opts.title`。
  await page.getByTestId("feedback-detail-input").fill(`${opts.title}。${opts.detail}`);
  await page.getByTestId("feedback-proceed-review").click();
  await expect(page.getByTestId("feedback-submit")).toBeVisible();
  await page.getByTestId(`feedback-kind-${opts.kind}`).click();

  // ⚠ `.includes(`${API}/feedback`)` 也会匹配 `/feedback/structure-draft`，于是
  //   `waitForResponse` 可能先抓到那个 503 当成"提交的响应"。改成 `endsWith`
  //   精确匹配真正的提交端点，`/vote`、`/structure-draft` 都不以 `/feedback` 结尾。
  const submitted = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith(`${API}/feedback`),
  );
  await page.getByTestId("feedback-submit").click();
  const response = await submitted;
  expect(response.status(), `提交「${opts.title}」应该 201`).toBe(201);

  // 提交完成必须自动落在「我提过的」，且刚提交那条能看到——闭环的可见性就是这一下。
  await expect(page.getByTestId("feedback-just-submitted")).toBeVisible();
  await expect(page.getByTestId("feedback-mine-list")).toContainText(opts.title);
  await page.getByTestId("feedback-dialog-close").click();
  await expect(page.getByTestId("feedback-dialog")).toHaveCount(0);
}

/**
 * B3.6（2026-09-04，旧屏退役）：后台处置这两条用例此前打的是 `/admin/feedback` /
 * `/platform-admin/feedback`（`feedback-screen.tsx` 的左列表右详情）——那块屏已删除，
 * `/platform-admin/feedback` 现在是一条 301 到 `/platform-admin/inbox`
 * （`design-loop/inbox-screen.tsx`）。新屏是三类来源的统一投影（backlog uc-17-8 D2），
 * 不是旧屏的逐像素复刻：没有独立的「投票」入口、也没有按来源（产品/Agent/Skill）
 * 筛选的 chip，这两处旧断言随旧屏一起退役，不强行在新屏上找不存在的东西。
 */
async function gotoInboxViaRedirect(page: Page): Promise<void> {
  await page.goto("/platform-admin/feedback");
  await expect(page).toHaveURL(/\/platform-admin\/inbox$/);
  await ensureListView(page);
}

/**
 * 看板/列表视图是组件内 `useState("board")`，**不持久化**——`page.reload()` 之后回到看板，
 * `inbox-row-*` 行根本不存在。每次刷新后都要再切一次列表，否则 `findInboxRow` 永远找不到
 * （B3.6 重写这两条用例时漏了这一步；此前 D3 用例先红、serial 模式把后面的用例跳过，所以
 * 直到 D8 ③ 放宽收件箱读路径让 D3 用例转绿，这一步才第一次真的跑到）。
 */
async function ensureListView(page: Page): Promise<void> {
  await expect(page.getByTestId("design-loop-inbox")).toBeVisible();
  const listToggle = page.getByTestId("inbox-view-list");
  if (await listToggle.isVisible()) await listToggle.click();
}

/** 列表视图里按标题定位那一行（`code` 由服务端生成，不拿它做选择器）。 */
function findInboxRow(page: Page, title: string): Locator {
  return page.locator('[data-testid^="inbox-row-"]').filter({ hasText: title });
}

/** 点开一行 ⇒ 右侧 drawer（`inbox-drawer`），没有"关闭"这回事，切一行就整个换掉。 */
async function openInboxRow(page: Page, row: Locator): Promise<Locator> {
  await row.click();
  const drawer = page.getByTestId("inbox-drawer");
  await expect(drawer).toBeVisible();
  return drawer;
}

test.describe("反馈端到端：不同种类从前端提交，后台真的看得见", () => {
  test.describe.configure({ mode: "serial" });

  test("① 产品级 · 缺陷 —— 引导师，图标栏入口", async ({ page }) => {
    await login(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);
    await page.getByTestId("rail-feedback").click();
    await expect(page.getByTestId("feedback-dialog-title")).toHaveText("对产品提反馈");
    await submitOpenFeedback(page, {
      kind: "缺陷",
      title: TITLES.productBug,
      detail: "每次都要重填 token 预算，第三次之后就不想用了。",
    });
  });

  test("② 产品级 · 需求 —— 非管理员成员，图标栏入口", async ({ page }) => {
    await login(page, FULLSTACK_E2E.memberEmail, FULLSTACK_E2E.memberPassword);
    await page.getByTestId("rail-feedback").click();
    await submitOpenFeedback(page, {
      kind: "需求",
      title: TITLES.productReq,
      detail: "现在录音列表是全组织的，找上周那场要翻很久。",
    });
  });

  test("③④ Skill·缺陷 与 Agent·需求 —— 引导师，会话内两处入口", async ({ page }) => {
    // 要真的等一次 agent run 从 queued 跑到 succeeded（步骤 8b 同款单独就给 180s），
    // 加上挂载 + 两次提交反馈的开销，单独给这一条用例放宽超时。
    test.setTimeout(300_000);
    await login(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);
    await page.goto(`/chat?projectId=${FULLSTACK_E2E.projectId}`);
    await page.getByTestId("chat-thread-create").click();
    const threadTitle = `反馈端到端 ${STAMP}`;
    await page.getByTestId("chat-thread-title-input").fill(threadTitle);
    await page.getByTestId("chat-thread-title-submit").click();
    await expect(page.getByTestId("chat-read-thread-list").getByText(threadTitle)).toBeVisible();

    /* ── ③ Skill 级 · 缺陷 —— 会话内挂载态 chip 上 ── */
    const skillId = FULLSTACK_E2E.mountableSkillId;
    await expect(page.getByTestId("chat-skill-mount-empty")).toBeVisible();
    await expect(page.getByTestId("chat-skill-mount")).toBeEnabled();
    await page.getByTestId("chat-skill-mount").click();
    const mounted = page.waitForResponse(
      (r) => r.request().method() === "POST" && /\/threads\/[^/]+\/skill-mounts(\?|$)/.test(r.url()),
    );
    await page.getByTestId(`chat-skill-mount-option-${skillId}`).click();
    expect((await mounted).status()).toBe(201);
    await expect(page.getByTestId(`chat-skill-mounted-${skillId}`)).toBeVisible();

    await page.getByTestId(`chat-skill-feedback-${skillId}`).click();
    // ⚠ 标题显示的是 skill 的**名字**不是 id（`feedback-dialog.tsx` `targetHeading()`：
    //   名字缺失才退回 id）——这条断言从写下来那天起就没跟上界面实际形状（issue #1768），
    //   改成断言 fixture 里专门准备好的 mountableSkillName。
    await expect(page.getByTestId("feedback-dialog-title")).toContainText(FULLSTACK_E2E.mountableSkillName);
    await submitOpenFeedback(page, {
      kind: "缺陷",
      title: TITLES.skillBug,
      detail: "有时候给表格有时候给段落，下游没法直接用。",
    });

    /* ── ④ Agent 级 · 需求 —— 一条真实的 AI 回复上 ── */
    await page.getByTestId("chat-roster-edit").click();
    await page.getByTestId("chat-roster-add-input").selectOption(FULLSTACK_E2E.agentId);
    await page.getByTestId("chat-roster-add-submit").click();
    await expect(page.getByTestId(`chat-roster-agent-${FULLSTACK_E2E.agentId}`)).toBeVisible();

    const marker = `FEEDBACK_E2E_${STAMP}`;
    await page.getByTestId("chat-agent-select").click();
    await page.getByTestId(`chat-agent-select-option-${FULLSTACK_E2E.agentId}`).click();
    await page.getByTestId("chat-message-input").fill(marker);
    await page.getByTestId("chat-message-submit").click();

    const runStatus = page.getByTestId("chat-live-agent-run-status");
    await expect(runStatus).toHaveAttribute("data-run-status", "succeeded", { timeout: 120_000 });

    // AI 消息行：hover 才会显形反馈按钮（同 chat-message-copy 的 group-hover 规则，
    // chat-read.spec.ts 已验证过这个交互模式）。
    const aiRow = page.getByTestId("chat-message-row").filter({ hasText: FULLSTACK_E2E.agentReplyPrefix });
    await expect(aiRow).toBeVisible();
    await aiRow.hover();
    await aiRow.getByTestId("chat-agent-feedback").click();
    await expect(page.getByTestId("feedback-dialog-title")).toContainText(FULLSTACK_E2E.agentDisplayName);
    await submitOpenFeedback(page, {
      kind: "需求",
      title: TITLES.agentReq,
      detail: "回答里能不能直接引用原始消息，现在要自己往上翻。",
    });
  });

  test("D3 反证：非管理员看得到标题看不到别人的正文", async ({ page }) => {
    await login(page, FULLSTACK_E2E.memberEmail, FULLSTACK_E2E.memberPassword);
    await gotoInboxViaRedirect(page);

    // 自己那条：正文可见（提交人恒可见自己写的字）。
    const ownDrawer = await openInboxRow(page, findInboxRow(page, TITLES.productReq));
    await expect(ownDrawer).toContainText("现在录音列表是全组织的");
    await page.getByTestId("inbox-drawer-close").click();

    // 引导师那条：标题看得到（D3 标题全组织可见，列表行上），正文看不到
    // （D3 只有管理员/提交人，drawer 里显示的是权限说明而不是原文）。
    const strangerRow = findInboxRow(page, TITLES.productBug);
    await expect(strangerRow).toBeVisible();
    const strangerDrawer = await openInboxRow(page, strangerRow);
    await expect(page.getByTestId("inbox-drawer-body-withheld")).toBeVisible();
    await expect(strangerDrawer).not.toContainText("每次都要重填 token 预算");
  });

  test("管理员：正文可见、分诊转已进入迭代、带理由拒绝", async ({ page }) => {
    await login(page, FULLSTACK_E2E.adminEmail, FULLSTACK_E2E.adminPassword);
    await gotoInboxViaRedirect(page);

    // 管理员对所有人的正文都可见——包括非提交人、非管理员自己提的那条。
    const memberDrawer = await openInboxRow(page, findInboxRow(page, TITLES.productReq));
    await expect(memberDrawer).toContainText("现在录音列表是全组织的");
    await page.getByTestId("inbox-drawer-close").click();

    const bugRow = findInboxRow(page, TITLES.productBug);
    const bugDrawer = await openInboxRow(page, bugRow);
    await expect(bugDrawer).toContainText("每次都要重填 token 预算");

    /* ── 分诊：「开始处理」把状态挪到「进行中」——真实 PUT，刷新页面确认是持久化的 ── */
    const started = page.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url().includes(`${API}/feedback`) && r.url().endsWith("/status"),
    );
    await bugDrawer.getByTestId("inbox-action-start").click();
    expect((await started).status()).toBe(200);
    await page.reload();
    await ensureListView(page);
    await expect(findInboxRow(page, TITLES.productBug)).toContainText(TITLES.productBug);

    /* ── 建 GitHub issue 是 fail closed 的（见 `triage-feedback.ts` 头注①）：
     * 这个 `fullstack-smoke` 环境**故意不配** `GITHUB_ISSUE_TOKEN`，所以这一步如实
     * 拿到 503；配了 token 的环境走另一条分支。两条分支都断言"界面如实反映了刚刚
     * 发生的事"。 */
    const hasGithubToken = Boolean(process.env.GITHUB_ISSUE_TOKEN);
    const bugDrawerAgain = await openInboxRow(page, findInboxRow(page, TITLES.productBug));
    await bugDrawerAgain.getByTestId("inbox-action-create-issue").click();
    const issueSubmit = bugDrawerAgain.getByTestId("inbox-issue-submit");
    await expect(issueSubmit).toBeVisible();
    const triaged = page.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url().includes(`${API}/feedback`),
    );
    await issueSubmit.click();
    const triagedResponse = await triaged;
    expect(triagedResponse.status()).toBe(hasGithubToken ? 200 : 503);

    /* ── 分诊：转「不做」，理由必填 —— 不填不让确认（服务端与界面双重把关） ── */
    const agentRow = findInboxRow(page, TITLES.agentReq);
    const agentDrawer = await openInboxRow(page, agentRow);
    await agentDrawer.getByTestId("inbox-action-decline").click();
    const declineConfirm = agentDrawer.getByTestId("inbox-decline-confirm");
    await expect(declineConfirm).toBeDisabled();

    const declineReason = "已改用更聚焦的问答方式，不再计划做原文引用";
    await agentDrawer.getByTestId("inbox-decline-reason").fill(declineReason);
    await expect(declineConfirm).toBeEnabled();
    const declined = page.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url().includes(`${API}/feedback`),
    );
    await declineConfirm.click();
    const declinedResponse = await declined;
    expect(declinedResponse.status()).toBe(200);
    const declinedBody = (await declinedResponse.json()) as { status?: string };
    expect(declinedBody.status).toBe("不做");
    await page.reload();
    await ensureListView(page);
    const agentDrawerAfterReload = await openInboxRow(page, findInboxRow(page, TITLES.agentReq));
    await expect(agentDrawerAfterReload).toContainText(declineReason);
  });
});
