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
test("#467 mounting an agent into the thread roster survives a full page reload", async ({ page }) => {
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

  /* ── 🔴 已知契约缺口，用测试钉住而不是用注释描述 ─────────────────────────
   *
   * **刷新之后再改编制会 409。** 原因不是实现偷懒：`expectedRosterVersion` 是必填的
   * 乐观锁，而**全契约没有任何读端口下发 `rosterVersion`**——它只出现在
   * `updateAgentRoster.out`（`packages/contracts/src/chat.ts:509`），
   * `getAgentPanel.out`（同文件 :477）里没有。⇒ 刷新丢掉前端状态之后，客户端
   * **无从得知当前版本号**，只能从 DDL 默认值 0 起步，而库里此刻已经是 1。
   *
   * 修它要给契约的读端口加字段，而 `packages/contracts/src/**` 只有人类能改
   * （ADR-020），所以这里**不发明**、不静默重试、不猜 +1，而是把现状钉成断言：
   * 有人补上读侧版本号之后这条会变红，那正是提醒更新它的时刻。
   *
   * ⚠ 「移出」本身是好的——`tests/chat/agent-roster-mount-roundtrip.test.ts`
   *   在真实 Postgres 上验了加→读→移出→读不到的完整往返。坏的只有**跨页面加载**
   *   这一段。 */
  const staleResponse = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().includes(`/chat/threads/${CHAT_READ_E2E.threadId}/agents`)
  ));
  await page.getByTestId(`chat-roster-remove-${CHAT_READ_E2E.catalogOnlyAgentId}`).click();
  expect((await staleResponse).status(), "刷新后前端拿不到 rosterVersion ⇒ 乐观锁必然过期").toBe(409);
  await expect(page.getByTestId("chat-roster-mutate-error")).toContainText("VERSION_CHANGED");
  // 拒绝之后编制**没被改动**：服务端没有静默覆盖，界面也没假装删掉了。
  await expect(page.getByTestId(`chat-roster-agent-${CHAT_READ_E2E.catalogOnlyAgentId}`)).toBeVisible();
});

test("formal Chat refuses to invent a project context", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto("/chat");
  await expect(page.getByTestId("chat-missing-project-context")).toContainText("请先选择项目");
  await expect(page.getByText("demo")).toHaveCount(0);
});
