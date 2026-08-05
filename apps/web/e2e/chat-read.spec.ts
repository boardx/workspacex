import { expect, test } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

test("formal Chat writes and cursor-lists durable messages through real signed APIs", async ({ page }) => {
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
  await expect(page.getByText("只显示服务端持久消息；不会合成即时 AI 回复。")).toBeVisible();

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
  await page.getByTestId("chat-roster-add-input").fill(CHAT_READ_E2E.catalogOnlyAgentId);
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
 * #594 —— 这条用例**被改，不被删**。
 *
 * ## 它原本叫什么、当初防的是什么
 *
 * 原标题：`formal Chat refuses to invent a project context`。
 * 断言：无 `projectId` 进 `/chat` ⇒ 显示 `chat-missing-project-context`「请先选择项目」，
 * 且页面上不出现 `demo` 字样。
 *
 * **它当初是对的。** 它防的是本仓反复出现的那一种事故：读端口没有真实上下文时，
 * 界面**编一个**出来——渲染 mock / 示例数据，或者随便挑一个项目装作用户选了它。
 * `apps/web/app/chat/page.tsx` 的注释逐字写着「不提供……任何 mock fallback」。
 * 一旦编了，用户看到的对话内容与库里的东西无关，而**没有任何断言会因此变红**。
 *
 * ## 为什么预期变了
 *
 * #594（P0，人类在 devapp.boardx.us 实测）：Chat 是**独立入口**，
 * 不应强制「先建项目才能对话」。⇒「无项目 ⇒ 死路一条」不再是可接受的终态。
 *
 * ## 新行为怎么**继续防住**原来那件事
 *
 * 「无项目也能用」≠「无项目时伪造一个项目」——这两者之差就是 #594 的全部难点。
 * 所以拆成两条，各管一件：
 *
 *   · 第一条（**必须永远绿**）：不伪造。判据从「页面上没有 demo 字样」升级成
 *     **一条网络断言**——无 projectId 时不得对 `/chat/projects/<任意>/threads` 发请求。
 *     字符串匹配挡不住「挑了一个真实项目装作用户选了它」，网络断言挡得住：
 *     那种实现必然要拿某个 projectId 去列会话。这条比原来**更严**，不是放宽。
 *
 *   · 第二条（`test.fail`，#594 的缺口）：无项目时应当有**可用的入口**。
 *     现在它红着，而且红得有名字。翻正的那一刻由契约裁决决定，冲突清单见
 *     `apps/api/tests/chat/projectless-thread-create-gap.test.ts` 文件头。
 *
 * ⚠ 不要把第二条改成「静默跳到某个项目」来让它变绿——那正是第一条要红的东西。
 */
test("#594：无项目上下文时，Chat 不伪造一个项目（这一条永远绿）", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  // 收集**真实发生的**列会话请求。原断言只看渲染结果，看不见「后台已经替用户
  // 选好了一个项目」——而那才是「伪造上下文」最可能的落地形状。
  const listedProjects: string[] = [];
  page.on("request", (request) => {
    const match = /\/chat\/projects\/([^/]+)\/threads/.exec(request.url());
    if (match) listedProjects.push(match[1]!);
  });

  await page.goto("/chat");
  await expect(page.getByTestId("chat-missing-project-context")).toBeVisible();

  // 正样本配对：**同一条正则**在带 projectId 时必须命中，否则它可能从第一天起
  // 就在验「这个正则永远匹配不到东西」（本仓九次「全绿但空转」的典型形状）。
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.threadId}`)).toBeVisible();

  expect(
    listedProjects,
    "无 projectId 的那次访问不得列任何项目的会话；带 projectId 的那次必须且只能列夹具项目",
  ).toEqual([CHAT_READ_E2E.projectId]);
});

/**
 * #594 的缺口本体。**现在红着是对的**，见上面那段注释与
 * `apps/api/tests/chat/projectless-thread-create-gap.test.ts`。
 *
 * `test.fail()` 而不是 `skip`：`skip` 是隐形的，而这条一旦被实现就会报
 * "expected to fail but passed"，逼下一个人回来把它翻正（同 `core-loop.spec.ts` 的规矩）。
 */
test.fail("[#594] 无项目的用户直接进 /chat 就能开始一次对话", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto("/chat");
  // 「能开始对话」的最小判据：写入口在。不是「页面没报错」——那太弱。
  await expect(page.getByTestId("chat-thread-create")).toBeVisible();
});
