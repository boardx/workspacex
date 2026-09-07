import { expect, test, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { openFreshThread } from "./chat-task-workbench-fixture";
import { selectWorkbenchAgent } from "./support/workbench-run-evidence";

/**
 * issue #2919 —— Chat 核心路径的真栈回归。
 *
 * 本文件只补现有 chat-read 套件没有覆盖的两条路径：
 *
 * 1. 普通文本问答从浏览器发出，经真实 API 创建 run，最终消息写入真实 PostgreSQL，
 *    整页刷新后仍可见；
 * 2. 同一线程连续两轮时，第二轮的确定性 deep-agent 上游真的读取并引用第一轮输入。
 *
 * 运行中追加要求与刷新恢复已有专项真栈测试：
 * `agent-workbench-steering-acceptance.spec.ts` 和
 * `copilotkit-v2-run-restore-after-switch.spec.ts`。这里不复制，以免同一行为出现两份
 * 随时间漂移的验收定义。模型上游使用 loopback，但浏览器、API、run worker 与数据库
 * 均为真实实现。
 */
test.setTimeout(240_000);

type StoredMessage = {
  id: string;
  text: string;
  authorKind: "human" | "agent";
  agentRunId: string | null;
  createdAt: string;
};

async function sessionHeaders(page: Page): Promise<Record<string, string>> {
  const token = await page.evaluate(() => localStorage.getItem("wsx.sessionToken"));
  expect(token).toBeTruthy();
  return { Authorization: `Bearer ${token}` };
}

async function storedMessages(page: Page, threadId: string): Promise<StoredMessage[]> {
  const response = await page.request.get(`/chat/threads/${threadId}/messages?limit=100`, {
    headers: await sessionHeaders(page),
  });
  expect(response.ok()).toBe(true);
  return (await response.json() as { messages: StoredMessage[] }).messages;
}

async function sendAndWaitStoredReply(
  page: Page,
  threadId: string,
  text: string,
  expectedReplyText: string,
): Promise<void> {
  await page.getByTestId("copilotkit-v2-input").fill(text);
  await page.getByTestId("copilotkit-v2-send").click();
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(text, { timeout: 60_000 });
  await expect.poll(async () => {
    const messages = await storedMessages(page, threadId);
    return messages.some(
      (message) => message.authorKind === "agent" && message.text.includes(expectedReplyText),
    );
  }, { timeout: 120_000, intervals: [250, 500, 1_000] }).toBe(true);
}

test("简单聊天：一轮问答落入真实数据库，刷新后仍恢复同一条回复", async ({ page }) => {
  const threadId = await openFreshThread(page);
  await selectWorkbenchAgent(page, CHAT_READ_E2E.deepAgentId);
  const marker = `CORE-SIMPLE-${Date.now()}：请用一句话确认收到`;

  await sendAndWaitStoredReply(page, threadId, marker, marker);
  const beforeReload = await storedMessages(page, threadId);
  const user = beforeReload.find((message) => message.authorKind === "human" && message.text === marker);
  const assistant = beforeReload.find(
    (message) => message.authorKind === "agent" && message.text.includes(marker),
  );
  expect(user).toBeDefined();
  expect(assistant?.agentRunId).toEqual(expect.any(String));
  expect(user?.agentRunId).toBe(assistant?.agentRunId);

  const url = page.url();
  await page.reload({ waitUntil: "domcontentloaded" });
  expect(page.url()).toBe(url);
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(marker, {
    timeout: 30_000,
  });

  const afterReload = await storedMessages(page, threadId);
  expect(afterReload.filter((message) => message.id === user?.id)).toHaveLength(1);
  expect(afterReload.filter((message) => message.id === assistant?.id)).toHaveLength(1);
});

test("多轮对话：第二轮在同一线程引用第一轮输入，并分别持久化两个 run", async ({ page }) => {
  const threadId = await openFreshThread(page);
  await selectWorkbenchAgent(page, CHAT_READ_E2E.deepAgentId);
  const firstTurn = `CORE-CONTEXT-${Date.now()}：我的项目代号是白鹭`;

  const expectedRecall = `${CHAT_READ_E2E.deepAgentFollowupContextEchoPrefix} 你上一轮说的是：\"${firstTurn}\"。`;
  await sendAndWaitStoredReply(page, threadId, firstTurn, firstTurn);
  await sendAndWaitStoredReply(
    page,
    threadId,
    CHAT_READ_E2E.deepAgentFollowupContextTrigger,
    expectedRecall,
  );
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(expectedRecall, {
    timeout: 30_000,
  });

  const messages = await storedMessages(page, threadId);
  const firstUser = messages.find((message) => message.authorKind === "human" && message.text === firstTurn);
  const followupUser = messages.find(
    (message) => message.authorKind === "human"
      && message.text === CHAT_READ_E2E.deepAgentFollowupContextTrigger,
  );
  const recalledAnswer = messages.find(
    (message) => message.authorKind === "agent" && message.text.includes(expectedRecall),
  );
  const firstAnswer = messages.find(
    (message) => message.authorKind === "agent" && message.text.includes(firstTurn),
  );
  expect(firstUser).toBeDefined();
  expect(followupUser).toBeDefined();
  expect(firstAnswer?.agentRunId).toEqual(expect.any(String));
  expect(recalledAnswer?.agentRunId).toEqual(expect.any(String));
  expect(firstUser?.agentRunId).toBe(firstAnswer?.agentRunId);
  expect(followupUser?.agentRunId).toBe(recalledAnswer?.agentRunId);
  expect(recalledAnswer?.agentRunId).not.toBe(firstAnswer?.agentRunId);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(expectedRecall, {
    timeout: 30_000,
  });
});
