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
