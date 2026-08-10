import { expect, test } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

test("formal Chat writes and cursor-lists durable messages through real signed APIs", async ({ page }) => {
  // V3（PROP-CHAT-10ITER-001）—— 逐条复制要读写剪贴板，授予该源的剪贴板权限。
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.threadId}`)).toContainText("Controlled fixture thread");
  await expect(page.getByTestId(`chat-roster-agent-${CHAT_READ_E2E.agentId}`)).toContainText("Controlled Read Agent");
  await expect(page.getByTestId("chat-message-list")).toContainText("Controlled fixture message 01");
  await expect(page.getByTestId("chat-message-list")).not.toContainText("Controlled fixture message 51");

  await page.getByTestId("chat-messages-load-more").click();
  await expect(page.getByTestId("chat-message-list")).toContainText("Controlled fixture message 51");

  // 数的是**会话卡**，不是容器里所有 button。
  //
  // 这条原本写作 `getByTestId("chat-read-thread-list").getByRole("button")`，
  // 数的是整个左栏容器里的按钮数。#460 把「新建 / 改名 / 删除」三个写入口放进了
  // 同一个容器（`chat-read-screen.tsx` 的 `ThreadActions`，渲染依据是服务端下发的
  // `thread.mutate`），#489 又让这份能力在零会话时也能拿到 ⇒ 该断言从 1 变成 4，
  // **在 main 上红着**。这是 #460/#489 的回归，由 coord-chat-e2e 引入、在此收口。
  //
  // 修法是**收窄到真实出口**，不是放宽数字：这条断言的本意一直是「夹具里只有一条
  // 会话，列表就只列一条」，而会话卡有自己的 testid（`chat-thread-${card.id}`，
  // 见 `apps/web/components/chat/chat-read-screen.tsx:364`）。按前缀数会话卡，
  // 写入口按钮再增减都不会误伤它，而「多列出一条会话」仍然会红。
  //
  // ⚠ 不要改回按整个左栏计数，也不要把 1 改成 4 —— 后者是把断言绑死在
  // 「当前恰好有三个写入口」上，下一个人加一个按钮它又红，而它本来就不该管这件事。
  // ⚠ 也不要用 `data-testid^="chat-thread-"` 前缀：写入口的 testid
  // （`chat-thread-actions` / `-create` / `-rename` / `-delete`）与会话卡
  // `chat-thread-${card.id}` **共用同一前缀**，前缀匹配数出来是 5 不是 1。
  // （这一步我先写错过一次，实测 `Received: 5` 才发现是自己起的名撞了命名空间。）
  await expect(page.getByTestId("chat-thread-card-list").getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "消息内容" })).toBeVisible();
  await page.getByRole("textbox", { name: "消息内容" }).fill("Browser durable message");

  const requestPromise = page.waitForRequest((request) => (
    request.method() === "POST" && request.url().endsWith(`/chat/threads/${CHAT_READ_E2E.threadId}/messages`)
  ));
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST" && response.url().endsWith(`/chat/threads/${CHAT_READ_E2E.threadId}/messages`)
  ));
  await page.getByTestId("chat-message-submit").click();
  const [request, response] = await Promise.all([requestPromise, responsePromise]);
  expect(response.status()).toBe(202);
  expect(request.postDataJSON()).toMatchObject({
    text: "Browser durable message",
    agentId: CHAT_READ_E2E.agentId,
  });
  expect(request.postDataJSON().clientMessageId).toMatch(/^[0-9a-f-]{36}$/i);
  await expect(page.getByTestId("chat-message-queued")).toContainText("AgentRun 已排队");
  await page.getByTestId("chat-messages-load-more").click();
  await expect(page.getByTestId("chat-message-list")).toContainText("Browser durable message");
  await expect(page.getByText("Browser durable message")).toHaveCount(1);

  /**
   * V1（PROP-CHAT-10ITER-001）—— 发消息后消息区自动跟随到底：滚动容器停在底部
   * （scrollTop 到达 scrollHeight − clientHeight；内容不溢出时两值相等、断言仍成立，
   * 这是「自动跟随生效、视口没被留在上方」的守卫。真正的溢出跟随由 shots 截图佐证）。
   * ⚠ 这条必须在下面 V3 复制块**之前**——V3 会 hover 首行把视口拽到顶，之后再查底部会假红。
   */
  const distanceFromBottom = await page
    .getByTestId("chat-message-scroll")
    .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  expect(distanceFromBottom).toBeLessThanOrEqual(80);

  /**
   * V3（PROP-CHAT-10ITER-001）—— 逐条复制。复制按钮 hover 才显形（visibility），
   * 先 hover 消息行让它可点，再点击，断言剪贴板拿到了该消息的纯文本。
   */
  const firstRow = page.getByTestId("chat-message-row").first();
  await firstRow.hover();
  await firstRow.getByTestId("chat-message-copy").click();
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText.length).toBeGreaterThan(0);

  /**
   * #728 round 16 P10 —— 「落地为产物」按钮改为按服务端下发的 `artifact.land`
   * 能力渲染（个人线程恒无该能力 ⇒ 不渲染，见 chat-main-shots.spec.ts 的
   * count=0 断言）。这条是另一半反证：夹具用户是 facilitator（写角色，
   * `capabilitiesFor` 含 `artifact.land`），项目线程里按钮必须**还在**——
   * 把「按能力渲染」写歪成「一律不渲染」时，这里当场红。
   */
  await expect(page.locator('[data-testid^="chat-land-artifact-open-"]').first()).toBeVisible();
  await expect(
    page.getByText("只显示服务端持久化的消息；AI 回复来自真实执行完成的写回，不在本地伪造。"),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.threadId}`)).toContainText("Controlled fixture thread");
  await page.getByTestId("chat-messages-load-more").click();
  await expect(page.getByTestId("chat-message-list")).toContainText("Browser durable message");
});

/**
 * #467（roster 半边）—— 在会话里**加一个 agent**，**刷新后它还在**；再移出，刷新后没了。
 *
 * ## 「刷新后仍在」是这条用例唯一的重点
 *
 * 不刷新的话，`useState` 里的一个数组就能让界面看起来是对的。**刷新**把
 * React state 全部丢掉，页面重新走 login session → `GET /chat/threads/:id/agents`
 * → `PgChatRepository` → `chat_thread_agents`。只有真的写进了库才活得过这一下。
 *
 * ## data-testid 出处（写进断言前逐个在源码里定位过）
 *   · `chat-roster-add-input`            components/chat/chat-read-screen.tsx:644
 *   · `chat-roster-add-submit`           components/chat/chat-read-screen.tsx:651
 *   · `chat-roster-agent-${id}`          components/chat/chat-read-screen.tsx:670
 *   · `chat-roster-remove-${id}`         components/chat/chat-read-screen.tsx:682
 *   · `chat-thread-${id}`                components/chat/chat-read-screen.tsx:425
 *   · `login-email` / `login-password` / `login-submit`   components/entry/login-form.tsx:272 一带
 *
 * ## ⚠ 范围诚实
 *
 * 本用例证明的是**编制关系落库**，**不是**「agent 真的执行并产生回复」（那是 #414 + #413）。
 * 加进编制的 agent 不会因此就能跑。
 */
test("#467/#513 roster mount survives a reload, and the post-reload edit now succeeds", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.threadId}`)).toContainText("Controlled fixture thread");

  // 前提：目录里那个 agent 现在**不在**编制里。没有这条，下面的断言可能一开始就是真的。
  await expect(page.getByTestId(`chat-roster-agent-${CHAT_READ_E2E.agentId}`)).toBeVisible();
  await expect(page.getByTestId(`chat-roster-agent-${CHAT_READ_E2E.catalogOnlyAgentId}`)).toHaveCount(0);

  // ── 加入 ──────────────────────────────────────────────────────────────────
  const addResponse = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().includes(`/chat/threads/${CHAT_READ_E2E.threadId}/agents`)
  ));
  // #728 D2：加入 agent 的输入框现在收在编制栏头的「编辑」后面（照原型：编制区常态只
  // 显示谁在场，编辑是显式动作）。此前它常驻，等于永远挂着一个裸 agent id 输入框 ——
  // 正是 #594 人类要求消灭的形态。
  // ⚠ 断言一条没放宽：没有写权时「编辑」按钮本身不渲染，下面这行会如实红。
  // #619 叠加：点开之后那个字段是**选择器**（选自组织 agent 目录），所以是 selectOption
  // 而不是 fill —— 两件事都要成立：藏在编辑动作后面 ∧ 不是裸文本框。
  await page.getByTestId("chat-roster-edit").click();
  await page.getByTestId("chat-roster-add-input").selectOption(CHAT_READ_E2E.catalogOnlyAgentId);
  await page.getByTestId("chat-roster-add-submit").click();
  expect((await addResponse).status()).toBe(200);
  await expect(page.getByTestId(`chat-roster-agent-${CHAT_READ_E2E.catalogOnlyAgentId}`)).toBeVisible();

  // ⚠ 关键一步：刷新丢掉全部前端状态，再读一次服务端。
  await page.reload();
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.threadId}`)).toContainText("Controlled fixture thread");
  await expect(page.getByTestId(`chat-roster-agent-${CHAT_READ_E2E.catalogOnlyAgentId}`)).toBeVisible();

  // 原本就在编制里的那个没被误伤。
  await expect(page.getByTestId(`chat-roster-agent-${CHAT_READ_E2E.agentId}`)).toBeVisible();

  /* ── ✅ #513：这里曾经是一颗钉住契约缺口的 `toBe(409)`，现在翻正了 ──────────
   *
   * **PR #510 当时的现状**：刷新之后再改编制必定 409。原因不是实现偷懒——
   * `expectedRosterVersion` 是必填的乐观锁，而当时**没有任何读端口下发
   * `rosterVersion`**（它只在 `updateAgentRoster.out` 里）。⇒ 刷新丢掉前端状态之后
   * 客户端无从得知版本号。#510 没有发明字段、没有静默重试、没有猜 +1，而是把
   * 现状钉成 `toBe(409)`，并写明「有人补上读侧版本号之后这条会变红，那正是提醒
   * 更新它的时刻」。
   *
   * **那一刻就是 #513。** `getAgentPanel.out` 现在下发 `rosterVersion`
   * （🟡 该契约面**待人类补签**，见 `packages/contracts/src/chat.ts` 里
   * `getAgentPanel` 的文件头；**没有任何 `design-signoff.md` 被改动**），前端从那份
   * 响应里取版本号 ⇒ **上面那次 `page.reload()` 之后的这次「移出」现在应当成功**。
   *
   * ⚠ 这条断言的价值全在它**跨过了一次 `page.reload()`**：不刷新的话，写端口自己的
   *   回声就够用了，#513 修的那段路根本不会被走到。
   *
   * ⛔ 「读不到就传 0」不是修法：那等于把乐观锁摘了。真并发冲突仍然回 409
   *   ——那条由 `apps/api/tests/chat/agent-roster-version-read.test.ts` 的
   *   「乐观锁没被摘掉」守着。 */
  const removeResponse = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().includes(`/chat/threads/${CHAT_READ_E2E.threadId}/agents`)
  ));
  await page.getByTestId(`chat-roster-remove-${CHAT_READ_E2E.catalogOnlyAgentId}`).click();
  expect(
    (await removeResponse).status(),
    "#513 补上读侧 rosterVersion 后，跨页面加载的编制变更从 409 变为成功",
  ).toBe(200);
  await expect(page.getByTestId("chat-roster-mutate-error")).toHaveCount(0);
  // 真的移出了，并且**再刷新一次**它还是不在——落库了，不是界面上抹掉一行。
  await expect(page.getByTestId(`chat-roster-agent-${CHAT_READ_E2E.catalogOnlyAgentId}`)).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.threadId}`)).toContainText("Controlled fixture thread");
  await expect(page.getByTestId(`chat-roster-agent-${CHAT_READ_E2E.catalogOnlyAgentId}`)).toHaveCount(0);
  // 原本就在编制里的那个仍然没被误伤。
  await expect(page.getByTestId(`chat-roster-agent-${CHAT_READ_E2E.agentId}`)).toBeVisible();
});

/**
 * 🔴 #594（人类本人直接推翻此前裁决，方案 A）：无 `projectId` 时**不再拒绝**——
 * 走个人对话模式。这条用例原名"refuses to invent a project context"，原判据是
 * "请先选择项目"的拦截空态。**判据反过来了，防的洞没变**：原来防的是"读端口没有
 * 真实上下文时界面编一个项目出来"（mock 数据或悄悄挑一个真实项目装作用户选了它）；
 * 现在防的是**同一个洞的新形状**——无 `projectId` 时**不得**悄悄向任何
 * `/chat/projects/<任意 id>/threads` 发请求（那会是"编了一个项目"的铁证，
 * 字符串匹配挡不住这类洞，网络断言才挡得住，同 #602 那次分析的思路）。
 *
 * 正样本：个人模式确实调用了它自己的端口 `/chat/threads`（无 `:projectId` 段）。
 */
test("formal Chat with no projectId goes personal, never invents a project context", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  const personalThreadsRequest = page.waitForResponse((response) => (
    response.request().method() === "GET" && /\/chat\/threads(\?|$)/.test(response.url())
  ));
  const inventedProjectRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/chat\/projects\/[^/]+\/threads/.test(request.url())) inventedProjectRequests.push(request.url());
  });

  await page.goto("/chat");
  // 不再是"请先选择项目"的拦截空态——个人模式的左栏可见。
  // #728：栏头文案从「我的对话」改成「对话」（与项目对话共用同一个 `ThreadListHeader`，
  // 人类裁决：个人对话复用项目对话的壳，不许存在第二套视觉实现）。断言改锚在
  // 「不挂靠任何项目，仅自己可见」这句个人对话独有的说明文字上——它不会随共用组件
  // 的文案调整而漂移，且专门证明的是「这是个人模式，不是项目模式」这件事本身。
  await expect(page.getByTestId("chat-read-thread-list")).toContainText("不挂靠任何项目，仅自己可见");
  await expect((await personalThreadsRequest).status()).toBe(200);
  // 防的洞的新形状：全程没有向任何伪造的项目路径发过请求。
  expect(inventedProjectRequests, `不该有请求打到伪造的项目路径：${inventedProjectRequests.join(", ")}`).toHaveLength(0);
  await expect(page.getByText("demo")).toHaveCount(0);
});

test("V2（PROP-CHAT-10ITER-001）⌘↵ / Ctrl+↵ sends the composer message", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.threadId}`)).toContainText("Controlled fixture thread");

  const input = page.getByRole("textbox", { name: "消息内容" });
  await expect(input).toBeVisible();
  await input.fill("Sent via keyboard shortcut");

  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST" &&
    response.url().endsWith(`/chat/threads/${CHAT_READ_E2E.threadId}/messages`)
  ));
  // 键盘按下修饰键 + Enter：不点发送按钮，验证 onKeyDown 分支真的触发发送。
  // ControlOrMeta 让这条断言在 mac(⌘) 与 CI 的 linux(Ctrl) 上都成立。
  await input.press("ControlOrMeta+Enter");
  const response = await responsePromise;
  expect(response.status()).toBe(202);
  expect(response.request().postDataJSON()).toMatchObject({
    text: "Sent via keyboard shortcut",
    agentId: CHAT_READ_E2E.agentId,
  });
  await expect(page.getByTestId("chat-message-queued")).toContainText("AgentRun 已排队");
});

test("V4（PROP-CHAT-10ITER-001）loading skeleton shows while messages load, then yields to real messages", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  // 把消息 GET 拖住 ~2s，让首载骨架屏必然在场（否则真实上游太快、骨架一闪而过、
  // 断言会 racy）。延迟结束后放行，验证骨架被真实消息接管、不再残留。
  await page.route(`**/chat/threads/${CHAT_READ_E2E.threadId}/messages*`, async (route) => {
    if (route.request().method() === "GET") {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    await route.continue();
  });

  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  // 拖住的窗口内，骨架屏可见
  await expect(page.getByTestId("chat-message-loading-skeleton")).toBeVisible();
  // 放行后：骨架消失，真实消息到位
  await expect(page.getByTestId("chat-message-list")).toContainText("Controlled fixture message 01");
  await expect(page.getByTestId("chat-message-loading-skeleton")).toHaveCount(0);
});

test("V5（PROP-CHAT-10ITER-001）jump-to-latest button appears on scroll-up and returns to bottom", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  await expect(page.getByTestId("chat-message-list")).toContainText("Controlled fixture message 01");

  // 夹具有几十条消息 ⇒ 消息区溢出可滚。程序化把 scrollTop 置 0 会触发 scroll 事件，
  // 让「不在底部」判定成立、按钮出现。
  await page.getByTestId("chat-message-scroll").evaluate((el) => { el.scrollTop = 0; });
  await expect(page.getByTestId("chat-jump-to-latest")).toBeVisible();

  await page.getByTestId("chat-jump-to-latest").click();
  // 点击同步隐藏按钮（存在性断言，确定性）
  await expect(page.getByTestId("chat-jump-to-latest")).toHaveCount(0);
  // 平滑滚动落定后回到底部（poll 等动画收尾）
  await expect
    .poll(async () => page.getByTestId("chat-message-scroll")
      .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
    .toBeLessThanOrEqual(80);
});
