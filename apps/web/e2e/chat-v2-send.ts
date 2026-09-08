/**
 * issue #2997 —— CopilotKit v2 工作台的「发一条消息并拿到这一轮的 run / 回复」共用工具。
 *
 * ## 为什么需要这个文件
 *
 * `#2890`（`d30ac48e8`）之后 `/chat?projectId=…` 渲染的是 v2 工作台，旧屏
 * （`chat-live-message-panel.tsx`）已无可达路由。**两屏的发送线路不是同一条**：
 *
 * | | 旧屏 | v2 工作台 |
 * | --- | --- | --- |
 * | 浏览器发出的请求 | `POST /chat/threads/:id/messages` → `202 {agentRunId, runStatus}` | `POST /api/copilotkit/agent/:agentId/run`（AG-UI 流） |
 * | 落库由谁做 | 同一次请求（`acceptHumanMessage`） | 服务端 CopilotKit runtime 侧的 `acceptHumanMessage` |
 * | 浏览器能直接拿到 runId 吗 | 能（响应体里） | **不能**（流里没有这个字段） |
 *
 * 实测取证（`chat-v2-parity-probe`，真栈单跑，2026-09-08）：v2 点一次发送，浏览器
 * 打出的是
 * `POST http://127.0.0.1:<port>/api/copilotkit/agent/default/run`（随后一条
 * `/suggest`），**整轮没有任何一次 `POST /chat/threads/:id/messages`**。
 *
 * 于是所有原本「等 `POST …/messages` 的 202、从响应体里取 `agentRunId`」的 e2e 辅助
 * 函数在 v2 上都会挂死在超时上——不是断言变红，是**永远等不到**。本文件提供两条
 * 与传输无关的替代：
 *
 *   · `sendViaWorkbench()` —— 发送，并等到那条真实的上行 run 请求发出。
 *   · `awaitAssistantReply()` —— 直连契约读端口 `GET /chat/threads/:id/messages`
 *     （`listMessages`）轮询，等到这一轮**新落库**的 assistant 消息，返回它的
 *     `id` / `agentRunId` / `text`。
 *
 * `awaitAssistantReply` 读的是**落库投影**，比旧屏那条"从 202 响应体里取 runId"
 * **更强**：它同时证明了这一轮真的写进了库，而不只是被接收了。
 */
import { expect, type Page, type Request } from "@playwright/test";
import { SESSION_TOKEN_STORAGE_KEY } from "../lib/api-client";

/** v2 发送真正打出去的那条路径（实测，见文件头注）。只匹配 pathname，不含端口/查询。 */
export const V2_SEND_WIRE = /\/api\/copilotkit\/agent\/[^/]+\/run$/;

/** 从 localStorage 取真实签名会话 token（与既有 spec 同一套做法）。 */
export async function bearerOf(page: Page): Promise<string> {
  const token = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_TOKEN_STORAGE_KEY);
  expect(token, "登录之后 localStorage 里应有 session token").toBeTruthy();
  return token as string;
}

/** `listMessages` 契约的响应形状（`packages/contracts/src/chat.ts` 的 `DurableMessage`）。 */
export type PersistedMessage = {
  readonly id: string;
  readonly authorKind: string;
  readonly agentId: string | null;
  readonly text: string;
  readonly clientMessageId: string | null;
  readonly agentRunId: string | null;
};

/** 直连契约读端口把这条线程当前落库的消息读回来（真实签名鉴权，不经过任何前端状态）。 */
export async function listPersistedMessages(
  page: Page, threadId: string, bearer: string,
): Promise<readonly PersistedMessage[]> {
  const res = await page.request.get(
    `/chat/threads/${encodeURIComponent(threadId)}/messages?limit=100`,
    { headers: { Authorization: `Bearer ${bearer}` }, failOnStatusCode: false },
  );
  if (!res.ok()) return [];
  const body = await res.json() as { messages?: PersistedMessage[] };
  return body.messages ?? [];
}

/**
 * 在 v2 工作台里发一条消息，并等到那条真实的上行 run 请求发出。
 *
 * ⚠ 只等"请求发出"，不等 run 结束——等终态是 `awaitAssistantReply` 的事，两件事
 *   分开才能让调用方在中间断言"发送瞬间"的界面状态（等待态指示、输入框清空…）。
 */
export async function sendViaWorkbench(page: Page, text: string): Promise<Request> {
  const input = page.getByTestId("copilotkit-v2-input");
  await expect(input).toBeVisible({ timeout: 60_000 });
  await input.fill(text);
  const requestPromise = page.waitForRequest(
    (r) => r.method() === "POST" && V2_SEND_WIRE.test(new URL(r.url()).pathname),
    { timeout: 60_000 },
  );
  await page.getByTestId("copilotkit-v2-send").click();
  return requestPromise;
}

/**
 * 等这一轮真实落库的 assistant 回复。
 *
 * `knownMessageIds` 传发送**之前**已经在库里的那批 id——只有不在这批里的 assistant
 * 消息才算"这一轮的"，避免把线程里既有的历史回复误当成本轮结果（夹具线程往往
 * 已经有几十条历史，不做这个排除的话第一次轮询就会立刻"成功"）。
 */
export async function awaitAssistantReply(
  page: Page, threadId: string, bearer: string,
  knownMessageIds: ReadonlySet<string>,
  timeoutMs = 90_000,
): Promise<PersistedMessage> {
  let found: PersistedMessage | null = null;
  await expect.poll(async () => {
    const messages = await listPersistedMessages(page, threadId, bearer);
    found = messages.find((m) => !knownMessageIds.has(m.id) && m.authorKind === "agent" && m.agentRunId !== null) ?? null;
    return found !== null;
  }, { timeout: timeoutMs, intervals: [1_000, 2_000, 3_000] }).toBe(true);
  return found!;
}

/** 发送前先记下已有消息 id，供 `awaitAssistantReply` 排除历史。 */
export async function snapshotMessageIds(
  page: Page, threadId: string, bearer: string,
): Promise<ReadonlySet<string>> {
  return new Set((await listPersistedMessages(page, threadId, bearer)).map((m) => m.id));
}
