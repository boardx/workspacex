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
  await page.getByTestId(`feedback-kind-${opts.kind}`).click();
  await page.getByTestId("feedback-title-input").fill(opts.title);
  await page.getByTestId("feedback-detail-input").fill(opts.detail);

  const submitted = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().includes(`${API}/feedback`) && !r.url().includes("/vote"),
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

/** 在 `/admin/feedback` 上按标题定位那一行（2026-09-02 下午起是左列表右详情，不再是卡片）——不依赖服务端生成的 id。 */
function findAdminRow(page: Page, title: string): Locator {
  return page.locator('[data-testid^="admin-feedback-item-"]').filter({ hasText: title });
}

/**
 * 右侧详情面板（`role="region"`，`data-testid="admin-feedback-detail-<id>"`）。点一行就换成那一条，
 * 没有"关闭"这回事。⚠ 选择器带 `[role="region"]`：同一前缀也匹配得到面板内部的
 * `admin-feedback-detail-withheld-<id>`（正文无权时那句说明），不加会撞 strict-mode。
 */
function detailPanelLocator(page: Page): Locator {
  return page.locator('[role="region"][data-testid^="admin-feedback-detail-"]');
}

async function selectRow(page: Page, row: Locator): Promise<Locator> {
  await row.click();
  const panel = detailPanelLocator(page);
  await expect(panel).toBeVisible();
  return panel;
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
    await page.goto("/admin/feedback");

    // 自己那条：正文可见（提交人恒可见自己写的字）。正文在右侧详情里；那条是需求，
    // 在「需求建议」页。
    await page.getByTestId("admin-feedback-tab-需求").click();
    const ownDetail = await selectRow(page, findAdminRow(page, TITLES.productReq));
    await expect(ownDetail).toContainText("现在录音列表是全组织的");

    // 引导师那条：标题看得到（D3 标题全组织可见，列表行上），正文看不到
    // （D3 只有管理员/提交人，详情里显示的是权限说明而不是原文）。
    await page.getByTestId("admin-feedback-tab-缺陷").click();
    const strangerRow = findAdminRow(page, TITLES.productBug);
    await expect(strangerRow).toBeVisible();
    const strangerDetail = await selectRow(page, strangerRow);
    await expect(strangerDetail).toContainText("仅组织管理员与提交人可见");
    await expect(strangerDetail).not.toContainText("每次都要重填 token 预算");
  });

  test("管理员：两页各两条、来源筛选、投票/分诊/带理由拒绝三连", async ({ page }) => {
    await login(page, FULLSTACK_E2E.adminEmail, FULLSTACK_E2E.adminPassword);
    await page.goto("/admin/feedback");

    // 2026-09-02 下午起：缺陷 / 需求各一个标签页（见 `feedback-screen.tsx` 头注）。
    // 两条缺陷在「缺陷反馈」页，两条需求在「需求建议」页，来源是可叠加的筛选条件。
    const bugList = page.getByTestId("admin-feedback-list-缺陷");
    await expect(bugList).toContainText(TITLES.productBug);
    await expect(bugList).toContainText(TITLES.skillBug);
    await expect(bugList).not.toContainText(TITLES.productReq);
    await expect(bugList).not.toContainText(TITLES.agentReq);

    await page.getByTestId("admin-feedback-filter-source-product").click();
    await expect(bugList).toContainText(TITLES.productBug);
    await expect(bugList).not.toContainText(TITLES.skillBug);

    // 来源列：`Skill · <名字>` + 一行裸 id（名字由客户端 `listSkills` 解析，解析不到退回 id）。
    await page.getByTestId("admin-feedback-filter-source-skill").click();
    await expect(bugList).toContainText(TITLES.skillBug);
    await expect(bugList).toContainText(FULLSTACK_E2E.mountableSkillId);
    await expect(bugList).not.toContainText(TITLES.productBug);
    await page.getByTestId("admin-feedback-filter-source-all").click();

    await page.getByTestId("admin-feedback-tab-需求").click();
    const reqList = page.getByTestId("admin-feedback-list-需求");
    await expect(reqList).toContainText(TITLES.productReq);
    await expect(reqList).toContainText(TITLES.agentReq);
    await page.getByTestId("admin-feedback-filter-source-agent").click();
    await expect(reqList).toContainText(TITLES.agentReq);
    await expect(reqList).toContainText(FULLSTACK_E2E.agentId);
    await expect(reqList).not.toContainText(TITLES.productReq);
    await page.getByTestId("admin-feedback-filter-source-all").click();

    // 管理员对所有人的正文都可见——包括非提交人、非管理员自己提的那条。正文在右侧详情里。
    const memberDetail = await selectRow(page, findAdminRow(page, TITLES.productReq));
    await expect(memberDetail).toContainText("现在录音列表是全组织的");

    await page.getByTestId("admin-feedback-tab-缺陷").click();
    const bugRowAsAdmin = findAdminRow(page, TITLES.productBug);
    const bugDetail = await selectRow(page, bugRowAsAdmin);
    await expect(bugDetail).toContainText("每次都要重填 token 预算");

    /* ── 投票：真实 COUNT(*)，不是本地乐观值（票数按钮在列表行上，无票显示 —） ── */
    const voteButton = bugRowAsAdmin.locator('[data-testid^="admin-feedback-vote-"]');
    await expect(voteButton).toContainText("—");
    const voted = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes(`${API}/feedback`) && r.url().includes("/vote"),
    );
    await voteButton.click();
    expect((await voted).status()).toBe(200);
    await expect(voteButton).toContainText("1");

    /* ── 分诊：「进入迭代」——先展开可编辑的 GitHub issue 草稿框 ──
     * 建 issue 是 fail closed 的（见 `triage-feedback.ts` 头注①）：这个 `fullstack-smoke`
     * 环境**故意不配** `GITHUB_ISSUE_TOKEN`，所以这一步如实拿到 503，状态原样不动；
     * 配了 token 的环境走另一条分支。两条分支都断言到"界面如实反映了刚刚发生的事"。 */
    const hasGithubToken = Boolean(process.env.GITHUB_ISSUE_TOKEN);
    const toIterating = bugDetail.locator('[data-testid^="admin-feedback-to-已进入迭代-"]');
    await toIterating.click();
    const issueSubmit = bugDetail.locator('[data-testid^="admin-feedback-issue-submit-"]');
    await expect(issueSubmit).toBeVisible();
    const triaged = page.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url().includes(`${API}/feedback`),
    );
    await issueSubmit.click();
    const triagedResponse = await triaged;

    if (hasGithubToken) {
      expect(triagedResponse.status()).toBe(200);
      await expect(bugRowAsAdmin).toContainText("已进入迭代");
      await page.reload();
      const bugRowAfterReload = findAdminRow(page, TITLES.productBug);
      await expect(bugRowAfterReload).toContainText("已进入迭代");
      await expect(bugRowAfterReload).toContainText("1"); // 票数也一并确认是持久化的
    } else {
      // fail closed：503，屏上如实显示"操作没有生效"，状态**没有**变成「已进入迭代」，
      // 之前那次投票的票数也没有被这次失败动过。
      expect(triagedResponse.status()).toBe(503);
      await expect(page.getByTestId("admin-feedback-action-error")).toBeVisible();
      await expect(bugRowAsAdmin).not.toContainText("已进入迭代");
      await expect(voteButton).toContainText("1");

      await page.reload();
      const bugRowAfterReload = findAdminRow(page, TITLES.productBug);
      await expect(bugRowAfterReload).toContainText("待处理");
      await expect(bugRowAfterReload).toContainText("1");
    }

    /* ── 分诊：转「不做」，理由必填 —— 不填不让确认（服务端与界面双重把关） ── */
    await page.getByTestId("admin-feedback-tab-需求").click();
    const agentRowAsAdmin = findAdminRow(page, TITLES.agentReq);
    const agentDetail = await selectRow(page, agentRowAsAdmin);
    const toDecline = agentDetail.locator('[data-testid^="admin-feedback-to-不做-"]');
    await toDecline.click();
    const declineSubmit = agentDetail.locator('[data-testid^="admin-feedback-decline-submit-"]');
    await expect(declineSubmit).toBeDisabled();

    const declineReason = "已改用更聚焦的问答方式，不再计划做原文引用";
    const declineReasonInput = agentDetail.locator('[data-testid^="admin-feedback-decline-reason-"]');
    await declineReasonInput.fill(declineReason);
    await expect(declineSubmit).toBeEnabled();
    const declined = page.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url().includes(`${API}/feedback`),
    );
    await declineSubmit.click();
    const declinedResponse = await declined;
    expect(declinedResponse.status()).toBe(200);
    const declinedBody = (await declinedResponse.json()) as { status?: string };
    expect(declinedBody.status).toBe("不做");
    await expect(agentRowAsAdmin).toContainText("不做");
    // 处理说明在右侧详情里。
    await expect(detailPanelLocator(page)).toContainText(declineReason);
  });
});
