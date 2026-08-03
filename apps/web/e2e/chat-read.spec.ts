import { expect, test } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

test("formal Chat reads the controlled fixture through real signed APIs", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.threadId}`)).toContainText("Controlled fixture thread");
  await expect(page.getByTestId(`chat-roster-agent-${CHAT_READ_E2E.agentId}`)).toContainText("Controlled Read Agent");
  await expect(page.getByTestId("chat-message-list")).toContainText("Controlled fixture message 01");
  await expect(page.getByTestId("chat-message-list")).not.toContainText("Controlled fixture message 21");

  await page.getByTestId("chat-messages-next").click();
  await expect(page.getByTestId("chat-message-list")).toContainText("Controlled fixture message 21");
  await expect(page.getByTestId("chat-message-page-status")).toHaveText("2 / 2");

  await expect(page.getByTestId("chat-read-thread-list").getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByText(/发送消息|新建对话|AI 回复/)).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.threadId}`)).toContainText("Controlled fixture thread");
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
