import { expect, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "../chat-read-fixture";
import { openChatEmptyState, openFreshThread } from "../chat-task-workbench-fixture";
import {
  createThreadViaApi,
  openAuthoritativeFreshThread,
  sessionHeaders,
} from "./authoritative-thread";
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

/**
 * `sessionHeaders` / `createThreadViaApi` 现在住在 `support/authoritative-thread.ts`
 * （issue #3118：两条车道共用同一个建线程入口，本文件只再导出，不留第二份实现）。
 */
export { sessionHeaders, createThreadViaApi };

export interface StoredMessage {
  readonly id: string;
  readonly text: string;
  readonly authorKind: "human" | "agent";
  readonly agentRunId: string | null;
  readonly createdAt: string;
}

/** 权威读：直接问 API 这条线程**落库**的消息，不看渲染出来的那一帧。 */
/**
 * 等这条线程上**指定那条用户消息**真的落库，返回落库后的全量消息。
 *
 * 三跑实测教训（F7）：发送后 UI 上出现那句话 ≠ 它已经写进库。F7 当时只等 UI 就直接读
 * 库，`humanTurn` 为 `undefined`，红在一条与被测路径无关的地方。UI 与落库是两个时刻，
 * 要读库就得等库。
 */
export async function awaitStoredHumanMessage(
  page: Page,
  threadId: string,
  text: string,
): Promise<StoredMessage[]> {
  await expect
    .poll(async () => (await storedMessages(page, threadId))
      .some((m) => m.authorKind === "human" && m.text === text), {
      timeout: 60_000,
      intervals: [500, 1_000, 2_000],
    })
    .toBe(true);
  return await storedMessages(page, threadId);
}

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
/*
 * issue #3118：`openFreshThread` 本身已改走权威端口（见
 * `support/authoritative-thread.ts`），这里不再需要单独处理「点新建可能复用旧线程」。
 */
export async function openFreshDeepAgentThread(page: Page): Promise<string> {
  const threadId = await openFreshThread(page);
  await selectWorkbenchAgent(page, CHAT_READ_E2E.deepAgentId);
  return threadId;
}

/**
 * 同上，但用于**同一 browser context 里的第二个 page**：不再走登录，且**不点
 * 「新建对话」按钮**——线程用权威端口建出来，页面直接深链进去。
 *
 * ## 为什么不点那颗按钮（issue #3101，run 34210719166 产物定案）
 *
 * 「新建对话」在本仓**不保证创建新线程**：`copilotkit-v2-shell.tsx` 的 `handleCreate`
 * 在列表最上面那条已经是 `not-started` 空线程时，直接进那一条（issue #2094 +
 * 2026-08-30 人类实测反馈的裁决，防空线程无限累积）。而 F6 里 page A 刚建出的线程
 * 正好就是那条空线程 ⇒ page B 点「新建」按设计复用它 ⇒ `threadA === threadB`。
 *
 * 这个夹具此前七跑全部红在同一个错误假设上（「点新建 ⇒ 一定多一条线程」），每跑只是
 * 换一种近似信号去指代「新建成功」。产物取证：那一跑的 trace 里 `/chat/threads` **全是
 * GET，零 POST**——前端压根没发创建请求，不是导航没跟上。
 *
 * 并发建线程本来就不是 F6 的被测对象（spec 自己的注释逐字这么写），被测对象是两条
 * 线程上**同时跑的两个 run**。所以这里换成权威端口建线程：它必然给出一条属于这个
 * page 自己的线程，不依赖按钮上叠的任何复用/导航语义。
 *
 * ⚠ 两个 page 仍共享 context（真实用户开两个标签页），登录态因此已经有了——再
 * `goto("/login")` 会被重定向走，`login-email` 永不出现（二跑实测烧掉 300s）。
 */
export async function openFreshDeepAgentThreadOnAuthedPage(page: Page): Promise<string> {
  await warmUpCopilotRuntimeRoute(page);
  const threadId = await openAuthoritativeFreshThread(page);
  await selectWorkbenchAgent(page, CHAT_READ_E2E.deepAgentId);
  return threadId;
}

/**
 * 新建一条空线程并选中**回显 agent**（`CHAT_READ_E2E.agentId`，走
 * `loopback-model-provider.ts`）—— 画布指引与 L2/L3 那几个回显开关都长在它身上，
 * deep-agent 那条替身没有它们。
 *
 * ## 顺序：先切 agent，再建线程
 *
 * 历史原因（**已于 issue #3028 解除**）：`copilotkit-v2-panel.tsx` 曾挂
 * `key={selectedAgentId}`，切 agent 会**卸载当前对话并开一条全新的**（新 threadId、
 * 空消息），所以线程 id 必须在切换**之后**才取，否则拿到的是切换前那条。
 *
 * #3028（2026-09-08）去掉了那个 `key`：换 agent 现在在同一条线程里发生，历史不清空，
 * 这条顺序约束因此不再是硬性的。需要**种好的历史**的用例（本车道的 A3）也因此
 * 不再需要 `test.fixme`，见那条 spec 的头注。
 *
 * 本函数在 #3118 之后改成**先建线程、再切 agent**：线程由权威端口建出来后要
 * `goto` 深链进去，导航前选的 agent 会随页面重载丢掉，所以切换只能在导航之后做
 * （与 `openFreshDeepAgentThreadOnAuthedPage` 同一个次序）。#3028 之后这不再影响
 * 历史——换 agent 留在同一条线程里。
 *
 * ## issue #3118：不再点「新建对话」按钮
 *
 * C4 与 D4 搬进阻塞车道 `chat-read` 后落到同一条线程互相污染（C4 的哨兵
 * `E2E-CANVAS-GUIDANCE-6031` 出现在 D4 的断言目标里），根因就是这颗按钮按设计
 * 复用顶部的空线程。改走权威端口后，`openAuthoritativeFreshThread` 深链进一条
 * 属于本用例自己的线程，随后再切 agent——次序与
 * `openFreshDeepAgentThreadOnAuthedPage` 一致：深链页的 threadId 来自路由，
 * 页面重挂载不会换线程。
 */
export async function openFreshEchoAgentThread(page: Page): Promise<string> {
  await openChatEmptyState(page);
  const threadId = await openAuthoritativeFreshThread(page);
  await selectWorkbenchAgent(page, CHAT_READ_E2E.agentId);
  return threadId;
}

/**
 * v2 面板：发一条消息，等到**落库**的 agent 回复里出现期待的串。
 *
 * 等的是权威读（`GET /chat/threads/:id/messages`）而不是 DOM 文本——回复气泡的渲染
 * 时机与落库时机是两件事，混着等会把「渲染慢」误判成「没答」。手法取自
 * `agent-chat-core-paths.spec.ts` 的 `sendAndWaitStoredReply`。
 *
 * ## `expectedInReply` 传数组时是「同一条回复里全都要有」
 *
 * ⚠ 多轮用例必须传一个**能把本轮与前几轮分开**的组合。五跑实测（C5）栽在这上面：
 * 判据只写 `"```canvas"` 时，第 2、3 轮的等待被**第 1 轮**那条回复满足 ⇒ 这一步在
 * 本轮回复其实还没落库时就返回，红被推到后面的画布数量断言上，而「第 3 轮回复没到」
 * 与「第 3 轮回复到了但画布没挂」在那条红里分不出来。
 *
 * 这与四跑修掉的那个缺陷是**同一个形状**（当时判据是 `SERIAL-<轮次>`，被通用回显分支
 * 满足）：判据必须同时具备「只有被测分支才满足」和「只有本轮才满足」两个性质，
 * 少一个都会让等待提前返回。传数组正是为了把这两个性质拼起来。
 */
export async function sendInV2AndAwaitStoredReply(
  page: Page,
  threadId: string,
  text: string,
  expectedInReply: string | readonly string[],
): Promise<void> {
  const expected = typeof expectedInReply === "string" ? [expectedInReply] : expectedInReply;
  await page.getByTestId("copilotkit-v2-input").fill(text);
  await page.getByTestId("copilotkit-v2-send").click();
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(text, { timeout: 60_000 });
  try {
    await expect
      .poll(async () => {
        const messages = await storedMessages(page, threadId);
        return messages.some((m) => m.authorKind === "agent" && expected.every((one) => m.text.includes(one)));
      }, { timeout: 180_000, intervals: [500, 1_000, 2_000] })
      .toBe(true);
  } catch (failure) {
    /*
     * 三跑实测教训（C4/C5）：等不到期待的串时，光看「180s 超时」分不出三件事——
     * 这一轮**根本没有回复**（run 失败/没跑）、**回复来自另一个 agent**（v2 换 agent
     * 会开新对话，见 #3028）、还是**回复来了但内容不对**（例如上游没命中画布分支，
     * 退回通用回显）。三者的处置完全不同，所以把这一轮真实落库的 agent 回复摘进
     * 失败信息。**不放宽判据**：期待的串仍然必须出现，否则照样红。
     */
    const all = await storedMessages(page, threadId);
    const replies = all.filter((m) => m.authorKind === "agent");
    const detail = replies.length === 0
      ? "这条线程上一条 agent 回复都没有落库——这一轮 run 没跑、失败了，或者消息进了另一条线程"
      : replies.map((m) => `· ${m.text.slice(0, 200).replace(/\n/g, "⏎")}`).join("\n");
    throw new Error(
      `${failure instanceof Error ? failure.message : String(failure)}\n\n`
      + `【诊断】期待同一条回复里同时含「${expected.join("」「")}」，`
      + `线程 ${threadId} 实际落库的 agent 回复：\n${detail}`,
    );
  }
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

/**
 * 「这一轮 assistant 回合真的产出并落定了」——**非空洞**的等待门（issue #3000 A 类根因）。
 *
 * ## 为什么必须新加一个，而不是继续用上面那个 `expectSendNotBlockedOnRun`
 *
 * 上面那个判的是「不等于 running」。点下发送之后有一段窗口 `agent.isRunning` 还是
 * false（run 还没建立），`data-send-state` 仍是 `ready`/`disabled`——这条判据在
 * **第一次采样**就满足，于是「等这一轮跑完」退化成「不等」。同一个坑
 * `real-model-pdf-smoke.spec.ts` 已经用 `sawRunning` 标记堵过一次（见那份头注）。
 *
 * 更糟的是 `copilotkit-v2-stream-frame-timing.spec.ts` / `copilotkit-v2-runtime-adapter.spec.ts`
 * 里各自抄了一份读 `title` 的旧版本，判的是 `title !== "Agent 正在处理上一条消息，请稍候…"`；
 * 而 2026-09-06「agent 还在生成时也要能回复 A/B」之后，`sendDisabledReason`
 * （`copilotkit-v2-panel-body.tsx`）已经**没有**这条理由了——那句文案在产品代码里
 * 只剩注释。判据因此**恒真**：run 从未开始也满足，第一次采样就返回。
 *
 * 这里改判**会随状况改变的信号**：先等 assistant 正文容器真的渲出非空文本
 * （run 压根没起来 / 没产出时这条会如实红，不会一秒钟"通过"），再等运行态落定。
 * 用"产出物"而不是"转瞬即逝的 running 态"当第一道门，不依赖采样频率恰好抓到那一帧。
 */
export async function expectAssistantTurnSettled(page: Page, timeoutMs = 90_000): Promise<void> {
  await expect
    .poll(
      async () => {
        const node = page.getByTestId("chat-ai-markdown").last();
        if ((await node.count()) === 0) return 0;
        return (await node.innerText().catch(() => "")).trim().length;
      },
      { timeout: timeoutMs, intervals: [250, 500, 1_000] },
    )
    .toBeGreaterThan(0);
  await expectSendNotBlockedOnRun(page, timeoutMs);
}
