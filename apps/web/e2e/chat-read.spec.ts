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

  await expect(page.getByTestId("chat-read-thread-list").getByRole("button")).toHaveCount(1);
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
