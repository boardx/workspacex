import { expect, type Page } from "@playwright/test";

/**
 * issue #3118 —— **所有** e2e 建线程的唯一入口。
 *
 * ## 为什么不能点「新建对话」按钮
 *
 * 「新建对话」在本仓**按设计不保证创建新线程**：`copilotkit-v2-shell.tsx` 的
 * `handleCreate` 在分组最上面那条已经是 `not-started` 空线程时，直接进那一条
 * （issue #2094 + 2026-08-30 人类实测反馈的裁决，防空线程无限累积）。
 * 这是**产品的正确行为**，不是缺陷。
 *
 * 于是「点新建 ⇒ 得到一条干净的新线程」这个前提对**所有**建线程 helper 都不成立。
 * 车道里多条 spec 并发跑时，谁先建出那条空线程由时序决定，其余 spec 的「新建」
 * 按设计复用它 ⇒ 两条用例落到同一条线程上互相污染。
 *
 * 直接证据（issue #3118，run 34221508209 / SHA `92236df86`）：C4 的哨兵
 * `E2E-CANVAS-GUIDANCE-6031` 出现在 D4 的断言目标 `copilotkit-v2-messages` 里，
 * 且 D4 的消息以 **steering 插话**形式进了 C4 仍在跑的 run
 * （「插话「SKILL-STATES-…」· 已收到，等待安全边界应用」）。
 *
 * ⚠ 串行度不是这里的自变量：线程复用是产品有意行为，只要还点那颗按钮，
 * 减并发只降低碰撞概率、不消除它（#3047 里 `workers: 1` 无效的原因）。
 *
 * ## 修法
 *
 * 走**权威端口** `POST /chat/threads/mutate`（`op: "create"`，契约见
 * `packages/contracts/src/chat.ts`）。这是那颗按钮背后**同一个**端口
 * （`handleCreate` → `createWorkbenchThread` → `createPersonalThread`），
 * 不是第二条建线程的路子；只是不经过按钮上叠着的复用语义。**产品行为不变，
 * 只改测试取线程的方式。**
 *
 * ## 例外：被测对象就是那颗按钮的 spec
 *
 * 少数 spec 的**被测对象本身**就是「新建对话」按钮的行为（复用空线程正是它的
 * 正确行为），那些 spec 自己内联点按钮，**不**走本模块，也不该改：
 * `copilotkit-v2-roster-landing.spec.ts`、`copilotkit-v2-thread-persistence.spec.ts`、
 * `copilotkit-v2-run-restore-after-switch.spec.ts`、`copilotkit-v2-skill-mount.spec.ts`、
 * `chat-main-shots.spec.ts`、`chat-behavior-shots.spec.ts`、
 * `core-journey-04-canvas-template-lifecycle-chat.spec.ts` / `core-loop.spec.ts`
 * （只断言按钮可见）、`support/workbench-journey.ts`。
 * 判据：**「这条 spec 若换成权威端口建线程，还测得到它想测的东西吗？」**
 * 答案是「测不到」的，留着点按钮。
 */

/** 本 worker 进程里已经发出去过的 threadId——用来机械证明「每次拿到的都是新的」。 */
const handedOutThreadIds = new Set<string>();

/**
 * 本模块所有函数的**前置条件**：`page` 必须已经处在应用自己的 document 上
 * （`http(s)://…`），因为取会话令牌要读 `localStorage`。
 *
 * ## 为什么是「抛」而不是「helper 自己补一次 goto」（issue #3129）
 *
 * #3127 把 `sessionHeaders` / `createThreadViaApi` 收敛成约 55 个调用点的唯一入口之后，
 * 「调用前该 page 已导航过同源文档」变成了这个共享 helper 的**隐式**前置条件；
 * `context.newPage()` 出来的 page 停在 `about:blank`（opaque origin），读 `localStorage`
 * 被浏览器直接拒绝，冒出来的是 `SecurityError`——它指向浏览器 API，不指向这条前置条件
 * （F6 就这么死过，run 34246633771 / SHA `9de57821e`）。
 *
 * 那为什么不在这里顺手 `goto` 补上？因为 `sessionHeaders` **不只在建线程时被调用**：
 * `storedMessages` / `storedRun` / `journalToolNames` 都在测试跑到一半、页面正停在被测
 * 线程上时反复调它（`expect.poll` 每 0.5~2s 一次）。在那里偷偷导航会把被测页面冲掉，
 * 把一条「读后端事实」的旁路变成会改页面状态的东西——**沉默的副作用比清晰的报错更贵**。
 * 所以这里只做**零副作用的检查**：已在同源文档上时一次导航都不发，不在时抛一条指名
 * 该前置条件、并说明修法的错误。单个调用点该怎么满足它，由调用点自己决定
 * （`openFreshDeepAgentThreadOnAuthedPage` 用 `ensureAuthedPageOrigin`，#3130）。
 */
export function assertPageOnAppOrigin(page: Page, caller = "sessionHeaders"): void {
  const url = page.url();
  if (/^https?:\/\//i.test(url)) return;
  throw new Error(
    `${caller}() 的前置条件未满足：page 必须已经导航到应用的同源文档，才能读 localStorage 里的会话令牌；` +
      `当前 page.url() 是 "${url}"。` +
      `这通常发生在 context.newPage() 之后直接建线程——page.request.*（如 warmUpCopilotRuntimeRoute）不改变 document/origin，救不了。` +
      `修法：先 await ensureAuthedPageOrigin(page)（或任何一次到应用页面的 goto），再调用本模块。（issue #3129）`,
  );
}

export async function sessionHeaders(page: Page): Promise<Record<string, string>> {
  assertPageOnAppOrigin(page);
  const token = await page.evaluate(() => localStorage.getItem("wsx.sessionToken"));
  expect(token, "登录后应有会话令牌；没有说明登录这一步本身就没成功").toBeTruthy();
  return { Authorization: `Bearer ${token}` };
}

/**
 * 权威建线程：直接打 `mutateThread`（`op: "create"`），返回服务端分配的 threadId。
 * 不导航、不断言线程为空——那两件由 `openAuthoritativeFreshThread` 做。
 */
export async function createThreadViaApi(page: Page): Promise<string> {
  const response = await page.request.post("/chat/threads/mutate", {
    headers: await sessionHeaders(page),
    data: {
      op: "create", projectId: null, threadId: null, groupId: null,
      title: null, visibilityScope: "private", expectedVersion: null, reason: null,
    },
  });
  expect(response.ok(), `建线程失败：${response.status()} ${await response.text()}`).toBe(true);
  const threadId = (await response.json() as { threadId: string }).threadId;
  expect(threadId, "建线程响应必须带 threadId").toBeTruthy();
  return threadId;
}

/**
 * 建一条线程、深链进去、并**在 helper 内部**证明它确实是新的且为空。
 *
 * 断言放在这里而不是每个调用点各写一遍，是因为「同一事实不得声明在两处」：
 * 约 55 个调用点各抄一份隔离断言，等于把 #3118 的漂移主动复现一次。
 *
 * 两条断言各自回答一个不同的问题：
 * - **是新的**：这个 id 在本 worker 进程里从没被发出去过。点按钮拿到复用的旧线程时，
 *   第二次调用会拿到与第一次相同的 id ⇒ 这一条会红（这正是 C4/D4 那对污染的形状）。
 * - **是空的**：权威读 `GET /chat/threads/:id/messages` 为 0 条。跨 worker / 跨 run
 *   的复用（Set 看不见的那一半）由这一条兜住。
 */
export async function openAuthoritativeFreshThread(page: Page): Promise<string> {
  const threadId = await acquireFreshThread(page);
  await page.goto(`/chat/${threadId}`);
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible({ timeout: 120_000 });
  return threadId;
}

/**
 * `openAuthoritativeFreshThread` 去掉导航的那一半：建线程 + 两条隔离断言，**不碰 DOM**。
 *
 * 单独拆出来是为了让 #3118 的反证能在 vitest 层确定性地跑（`tests/e2e-thread-fixture-isolation.test.ts`
 * 用一个实现了产品 `handleCreate` 复用规则的假后端，分别驱动「点按钮」与本函数）。
 * 拆的是**同一份实现**，不是给测试写的第二份——`openAuthoritativeFreshThread` 就调它。
 */
export async function acquireFreshThread(page: Page): Promise<string> {
  const threadId = await createThreadViaApi(page);
  expect(
    handedOutThreadIds.has(threadId),
    `建线程端口返回了本进程已经用过的线程 ${threadId}——它不是一条新线程（issue #3118）`,
  ).toBe(false);
  handedOutThreadIds.add(threadId);

  const messages = await page.request.get(`/chat/threads/${threadId}/messages?limit=5`, {
    headers: await sessionHeaders(page),
  });
  expect(messages.ok(), `读新线程消息失败：${messages.status()}`).toBe(true);
  expect(
    (await messages.json() as { messages: readonly unknown[] }).messages,
    `新建的线程 ${threadId} 必须是空的；有历史说明拿到的是别人用过的线程（issue #3118）`,
  ).toHaveLength(0);
  return threadId;
}

/** 仅反证/单测自用：让断言能从一个确定的空集出发。 */
export function __resetHandedOutThreadIdsForTest(): void {
  handedOutThreadIds.clear();
}
