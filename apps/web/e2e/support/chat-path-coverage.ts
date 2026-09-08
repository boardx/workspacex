import { expect, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "../chat-read-fixture";
import { openChatEmptyState, openFreshThread } from "../chat-task-workbench-fixture";
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
export async function openFreshDeepAgentThread(page: Page): Promise<string> {
  const threadId = await openFreshThread(page);
  await selectWorkbenchAgent(page, CHAT_READ_E2E.deepAgentId);
  return threadId;
}

/**
 * 同上，但用于**同一 browser context 里的第二个 page**：不再走登录。
 *
 * 二跑实测（F6）：同一 context 的两个 page 共享 origin 存储，第一个 page 登录之后，
 * 第二个 page 已经是已登录态 ⇒ `openChatEmptyState` 里的 `goto("/login")` 被重定向走，
 * `login-email` 永远不出现，又是首跑那个形态的第二种来源。并发用例恰恰**需要**共享
 * 登录态（真实用户开两个标签页），所以修的是"别再登一次"，不是"换成两个 context"。
 */
export async function openFreshDeepAgentThreadOnAuthedPage(page: Page): Promise<string> {
  await warmUpCopilotRuntimeRoute(page);
  await page.goto("/chat");
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible({ timeout: 120_000 });
  /*
   * ⚠ 这里的"新建成功"信号被实测推翻过**两次**，两次都让 `threadA === threadB`，
   * 两次都是同一件事的不同近似：**拿 URL 当创建结果读，而 URL 也会被别的东西改。**
   *
   * · 三跑：用 `waitForURL(/\/chat\/[^/]+$/)`。第二个 page `goto("/chat")` 之后壳会
   *   恢复到最近一条线程（正是第一个 page 刚建的那条），URL 当场就匹配 ⇒ 立即返回。
   * · 四跑（run 34190269467）：改成"等 URL 变成一条与点击前**不同**的线程"，仍然红。
   *   因为那次恢复是**异步**的：`before` 快照取在恢复落地之前（此时还是裸 `/chat`，
   *   `before` 为 null），随后满足"变成了不同的线程"的正是那次**恢复**，不是我们的创建。
   *
   * 两次近似都想用"变化"去指代"新建"，而这条 URL 上至少有两个东西会让它变化。
   * 唯一不会被恢复动作满足的信号是**这条线程此前不存在**——所以先用权威读把点击前
   * 已存在的线程 id 全取回来，再等 URL 落在一个**不在这个集合里**的 id 上。恢复只能
   * 恢复到已存在的线程，因此它无论早到晚到都无法满足这个判据。
   */
  /*
   * 五跑（run 34197984548）：这条判据**是对的，被它挡下来的是另一件事**。失败日志里
   * 整个 60s 只有一次导航——`navigated to /chat/thr-239c4580…`，而那个 id 在
   * `existing` 里 ⇒ 判据如实拒绝。也就是说：那次导航是**恢复**，我们的创建点击
   * 什么都没产生。判据没错，错的是**点击时机**：`copilotkit-v2-input` 可见只说明
   * 输入框挂上了，壳的「恢复到最近一条线程」还在路上，点击落在这个窗口里会被吞掉。
   *
   * 所以只加一件事：**允许重试点击本身**（取自本仓既有做法
   * `chat-canvas-guidance-render.spec.ts` 的 `clickMaximizeUntilModalVisible`——被软刷新
   * 吞掉的点击要重试，不是只重试断言）。判据本身不用改：恢复只会落在**已存在**的线程上，
   * 因此它无论早到晚到都满足不了"不在 existing 里"。
   *
   * ⚠ 六跑（run 34204114526）删掉过一个多余的前置门：当时先等"恢复落定（URL 上出现
   * 线程 id）"再点击，结果那一跑第二个 page 压根**没有发生恢复**，这道门自己 60s 超时。
   * 教训与本文件其它几处同形：不要把"通常会发生的事"写成前置条件——判据只依赖
   * **必然为真**的东西（这条线程此前不存在），不依赖壳恰好恢复。
   */
  const existing = new Set(await storedThreadIds(page));
  const landedOnNewThread = async (): Promise<boolean> => {
    const current = threadIdFromUrl(page.url());
    return current !== null && !existing.has(current);
  };
  for (let attempt = 0; attempt < 4 && !(await landedOnNewThread()); attempt += 1) {
    await page.getByTestId("chat-thread-create").click();
    try {
      await page.waitForURL((url) => {
        const current = threadIdFromUrl(url.toString());
        return current !== null && !existing.has(current);
      }, { timeout: 15_000 });
    } catch {
      // 这一次点击被恢复/软刷新吞了：再点一次。
    }
  }
  const threadId = threadIdFromUrl(page.url());
  expect(
    threadId !== null && !existing.has(threadId),
    "新建线程后 URL 应落在一条点击前并不存在的线程上——落在已存在的线程上说明拿到的是"
    + "壳恢复的那条，不是我们建的那条",
  ).toBe(true);
  await selectWorkbenchAgent(page, CHAT_READ_E2E.deepAgentId);
  return threadId as string;
}

/**
 * 权威读：当前用户此刻**已经存在**的全部个人线程 id。
 *
 * 只有一个用途：把「这条线程是我刚建的」与「壳把我恢复到了一条旧线程」分开——见
 * `openFreshDeepAgentThreadOnAuthedPage` 里那段头注记的两次实测。
 */
async function storedThreadIds(page: Page): Promise<string[]> {
  const response = await page.request.get("/chat/threads", { headers: await sessionHeaders(page) });
  expect(response.ok(), "读线程列表失败——没有它就分不出「新建的」与「恢复到的」").toBe(true);
  // 形状是契约里的 `listThreads.out`：按「今天/本周/更早」分组，线程在每组的 `cards` 里。
  const body = await response.json() as { groups?: { cards?: { id: string }[] }[] };
  return (body.groups ?? []).flatMap((group) => (group.cards ?? []).map((card) => card.id));
}

/** `/chat/<threadId>` 里的线程 id；裸 `/chat`、`/chat?…` 与 warmup 占位段一律返回 null。 */
function threadIdFromUrl(url: string): string | null {
  const matched = /\/chat\/(?!warmup-)([^/?#]+)/.exec(url);
  return matched?.[1] ?? null;
}

/**
 * 新建一条空线程并选中**回显 agent**（`CHAT_READ_E2E.agentId`，走
 * `loopback-model-provider.ts`）—— 画布指引与 L2/L3 那几个回显开关都长在它身上，
 * deep-agent 那条替身没有它们。
 *
 * ## 顺序不能反：先切 agent，再建线程
 *
 * `copilotkit-v2-panel.tsx` 的 `key={selectedAgentId}`：切 agent 会**卸载当前对话并
 * 开一条全新的**（新 threadId、空消息）。所以线程 id 必须在切换**之后**才取，
 * 否则拿到的是切换前那条、随后所有权威读都读错线程。
 *
 * ⚠ 这也是 issue **#3028** 的同一条机制：它让「深链进一条种好历史的线程」与
 * 「切到回显 agent」在 v2 上互斥。需要**种好的历史**的用例（本车道的 A3）因此
 * 暂时跑不起来，按 #2997 方案 B 的既有先例挂 `test.fixme` 等 #3028；不需要历史的
 * 用例（C4/C5：画布指引只依赖组织已发布模板 + 用户正文里的哨兵）走这条新建线程的路
 * 完全成立。
 */
export async function openFreshEchoAgentThread(page: Page): Promise<string> {
  await openChatEmptyState(page);
  await selectWorkbenchAgent(page, CHAT_READ_E2E.agentId);
  await page.getByTestId("chat-thread-create").click();
  await page.waitForURL(/\/chat\/(?!warmup-)[^/]+$/, { timeout: 60_000 });
  const threadId = /\/chat\/([^/?#]+)/.exec(page.url())?.[1];
  expect(threadId, "新建线程后 URL 应带上 threadId").toBeTruthy();
  return threadId as string;
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
