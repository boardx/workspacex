import { expect, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "../chat-read-fixture";
import { openFreshThread } from "../chat-task-workbench-fixture";
import { selectWorkbenchAgent } from "./workbench-run-evidence";

/**
 * 路径矩阵车道（`chat-path-*.spec.ts`）的共享外壳。
 *
 * ## 为什么是一个模块，不是每个 spec 各抄一份
 *
 * 与 `chat-task-workbench-fixture.ts` 头注那条理由逐字相同：本轮一次新增 8 个 spec，
 * 登录 / 焐热 / 取会话头 / 读落库消息这四件事在既有 spec 里已经被抄过至少五份
 * （`context-engine.spec.ts`、`chat-canvas-guidance-render.spec.ts`、
 * `copilotkit-v2-error-banner.spec.ts` 各有一份自己的 `login`/`warmUp`）。那是历史，
 * 不是规矩——再抄 8 份等于把「同一事实声明在多处」主动复现一次。
 *
 * ⚠ 本文件**不是** spec：文件名不以 `.spec.ts` 结尾，不会被任何 config 的 `testMatch`
 * 捞进去（同 `chat-read-fixture.ts` / `chat-task-workbench-fixture.ts` 的既有做法）。
 *
 * ## 路径标签（`@path:XX`）
 *
 * 每个 spec 的 `test()` 标题里都带一个 `@path:<矩阵编号>` 标签。它不是装饰：
 * `.harness/scripts/lint-chat-path-coverage.mjs` 用它把「矩阵里写了什么」与「仓库里
 * 真有什么 spec」机械对上——矩阵说有覆盖却找不到标签、或者标签指向矩阵里不存在的
 * 编号，都红。矩阵会腐烂（新增路径没人补表）是本仓那条「规范早就有、门控一直没有」
 * 的同一种病，这个标签是让它红的唯一机制。
 */

/** 矩阵文档——判据的唯一事实源，spec 只引用编号，不在这里复述判据本身。 */
export const PATH_MATRIX_DOC = ".harness/instructions/chat-path-coverage-matrix.md";

export async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

/** 同既有 spec：先把 CopilotRuntime 路由焐热（Next dev 按需编译，见既有各处头注）。 */
export async function warmUpCopilotRuntimeRoute(page: Page): Promise<void> {
  await expect
    .poll(async () => (await page.request.get("/api/copilotkit/info")).status(), {
      timeout: 60_000,
      intervals: [500, 1_000, 2_000],
    })
    .toBe(200);
}

export async function sessionHeaders(page: Page): Promise<Record<string, string>> {
  const token = await page.evaluate(() => localStorage.getItem("wsx.sessionToken"));
  expect(token, "登录后应有会话令牌；没有说明登录这一步本身就没成功").toBeTruthy();
  return { Authorization: `Bearer ${token}` };
}

export interface StoredMessage {
  readonly id: string;
  readonly text: string;
  readonly authorKind: "human" | "agent";
  readonly agentRunId: string | null;
  readonly createdAt: string;
}

/** 权威读：直接问 API 这条线程**落库**的消息，不看渲染出来的那一帧。 */
export async function storedMessages(page: Page, threadId: string): Promise<StoredMessage[]> {
  const response = await page.request.get(`/chat/threads/${threadId}/messages?limit=200`, {
    headers: await sessionHeaders(page),
  });
  expect(response.ok()).toBe(true);
  return (await response.json() as { messages: StoredMessage[] }).messages;
}

export interface StoredRun {
  readonly status: string;
  readonly resultMessageId?: string | null;
  readonly error?: string | null;
}

export async function storedRun(page: Page, runId: string): Promise<StoredRun> {
  const response = await page.request.get(`/agent-runs/${runId}`, {
    headers: await sessionHeaders(page),
  });
  expect(response.ok()).toBe(true);
  return await response.json() as StoredRun;
}

/**
 * 新建一条空线程并选中确定性 deep-agent —— v2 面板那几条路径的共同起点，
 * 手法逐字取自 `agent-chat-core-paths.spec.ts`（同一条真实链路，不是第二种起法）。
 *
 * ⚠ **调用它之前不要再自己 `login()` 或 `warmUpCopilotRuntimeRoute()`**：
 * `openChatEmptyState` 里两件都已经各做一次。已登录之后再 `goto("/login")`，应用会把
 * 这一跳重定向走，`login-email` 永远不出现，于是 `fill()` 一路等到测试超时——
 * 2026-09-08 本车道首跑，D4/F2/F6/F7 四条**全部**以这个形态各烧掉 4–5 分钟，
 * 一条真实断言都没跑到。既有的 `agent-chat-core-paths.spec.ts` 从来就是直接调
 * `openFreshThread`，是本车道第一版多加了那一步。
 */
export async function openFreshDeepAgentThread(page: Page): Promise<string> {
  const threadId = await openFreshThread(page);
  await selectWorkbenchAgent(page, CHAT_READ_E2E.deepAgentId);
  return threadId;
}

/**
 * 老聊天屏（项目内线程）的发送动作：填入 → 提交 → 断言服务端已受理（202）。
 *
 * 输入框等不到时**先把消息面板自己的错误态读出来再红**：2026-09-08 首跑里 A3/C4/C5
 * 三条都以「`消息内容` 30s 内没出现」收场，而线程列表已经正确渲染——光凭那条断言
 * 分不出「面板报了错」「还在加载」「输入框真的没渲染」，三种处置完全不同。把面板
 * 的 `chat-message-list-error` 正文拼进失败信息，是让下一次红自带诊断，不是放宽判据
 * （输入框仍然必须可见，否则照样红）。
 */
export async function sendOnProjectThread(page: Page, threadId: string, text: string): Promise<void> {
  const input = page.getByRole("textbox", { name: "消息内容" });
  const panelError = page.getByTestId("chat-message-list-error");
  try {
    await expect(input).toBeVisible();
  } catch (failure) {
    const detail = (await panelError.count()) > 0
      ? `消息面板处于错误态：${(await panelError.first().innerText()).trim()}`
      : "消息面板没有错误态——输入框是「没渲染」或「还没加载完」，不是「加载失败」";
    throw new Error(`${failure instanceof Error ? failure.message : String(failure)}\n\n【诊断】${detail}`);
  }
  await input.fill(text);
  const accepted = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().endsWith(`/chat/threads/${threadId}/messages`)
  ));
  await page.getByTestId("chat-message-submit").click();
  expect((await accepted).status()).toBe(202);
}

/**
 * 老聊天屏：等这一轮 run 成功落定，返回它写回的那条消息所在行。
 *
 * 读的是 `chat-live-agent-run-status` 上的两个属性（run 状态 + 写回消息 id），手法逐字
 * 取自 `context-engine.spec.ts` 的同名 helper——包括它头注记的那条坑：必须同时锚
 * `chat-message-row`，`data-message-id` 在同一条消息里挂在三个元素上，只按它选会
 * strict mode violation。
 */
export async function awaitProjectThreadReply(page: Page) {
  const status = page.getByTestId("chat-live-agent-run-status");
  await expect.poll(async () => status.getAttribute("data-run-status"), { timeout: 120_000 }).toBe("succeeded");
  await expect
    .poll(async () => status.getAttribute("data-result-message-id"), { timeout: 60_000 })
    .not.toBeNull();
  const resultMessageId = await status.getAttribute("data-result-message-id");
  expect(resultMessageId, "写回提交后必须能拿到回复消息 id").toBeTruthy();
  return page.locator(`[data-testid="chat-message-row"][data-message-id="${resultMessageId}"]`);
}

/** 等这条线程上刚发出的那次 run 走到终态（成功或失败都算落定）。 */
export async function waitForRunSettled(page: Page, timeout = 120_000): Promise<void> {
  await page.waitForResponse(async (response) => {
    if (response.request().method() !== "GET" || !/\/agent-runs\/[^/?]+$/.test(new URL(response.url()).pathname)) {
      return false;
    }
    try {
      const body = await response.json() as { status?: string };
      return body.status === "succeeded" || body.status === "failed";
    } catch {
      return false;
    }
  }, { timeout });
}

/**
 * 「这次 run 不再卡在运行中」的唯一读法——与 `copilotkit-v2-error-banner.spec.ts` 的
 * 同名 helper 同一条理由（`toBeEnabled()` 在 composer 清空后不再等价，见那份头注）。
 */
export async function expectSendNotBlockedOnRun(page: Page, timeoutMs = 60_000): Promise<void> {
  await expect
    .poll(() => page.getByTestId("copilotkit-v2-send").getAttribute("data-send-state"), { timeout: timeoutMs })
    .not.toBe("running");
}
