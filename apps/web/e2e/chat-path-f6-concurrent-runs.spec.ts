import { expect, test } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import {
  openFreshDeepAgentThread,
  openFreshDeepAgentThreadOnAuthedPage,
  storedMessages,
} from "./support/chat-path-coverage";

/**
 * 路径矩阵 **F6 · 并发双 run**（判据见 `.harness/instructions/chat-path-coverage-matrix.md`）。
 *
 * ## 全仓每一条 chat e2e 都是单 run 串行的
 *
 * `playwright.chat-read.config.ts` 明写 `fullyParallel: false`，既有用例一次只让一个
 * run 在跑。于是这一整类失效从未被任何测试碰过：
 *   · 事件流串线：A 线程的 token 渲染进 B 线程的气泡（transport 按 agent 而不是按
 *     thread 归拢时的典型形态）；
 *   · 落库互相覆盖：两次 run 抢同一条线程状态（L2 摘要的乐观并发在 `execute-run.ts`
 *     里有专门处理，但**跨线程**并发从未被端到端跑过）；
 *   · 后发的 run 把先发的顶掉：浏览器侧只保留"最后一次 run"的状态机。
 *
 * ## 判据：两条线程各自完整，且各自只有自己的东西
 *
 * 只断言"两个都成功"对串线恒绿——串线的两条线程也都会成功，只是内容进错了地方。
 * 所以必须**双向**断言：A 有 A 的、且 A **没有** B 的。
 *
 * ## 为什么是同一个 context 里的两个 page
 *
 * 两个 page 共享登录态（真实用户开两个标签页，正是这条路径的现实形态），但各有独立的
 * 事件流连接——串线要发生的话，正是在这个形状下发生。换成两个 context 也能并发，但
 * 那更像"两个用户"，测不到同一浏览器会话内 transport 归拢错线程这个真实失效。
 */
test.setTimeout(300_000);

function markerFor(lane: string): string {
  return `CONCURRENT-${lane}-${Date.now()}：请原样回显这句`;
}



test("@path:F6 两条线程同时跑：事件不串线、落库不互相覆盖", async ({ page, context }) => {
  const second = await context.newPage();
  try {
    // 顺序建线程（新建动作本身不是被测对象，且 Next dev 的按需编译会把并发建线程
    // 变成一次与被测路径无关的超时），随后**同时**发消息——并发发生在 run 上。
    const threadA = await openFreshDeepAgentThread(page);
    // 第二个 page 与第一个共享 context ⇒ 已经是已登录态，再走一次登录会被重定向走
    // （二跑实测：`login-email` 等到 300s 超时）。见该 helper 自己的头注。
    const threadB = await openFreshDeepAgentThreadOnAuthedPage(second);
    expect(threadA, "两条线程必须是不同的线程，否则这条用例测的是同一条线程的两轮").not.toBe(threadB);

    const markerA = markerFor("A");
    const markerB = markerFor("B");
    await page.getByTestId("copilotkit-v2-input").fill(markerA);
    await second.getByTestId("copilotkit-v2-input").fill(markerB);
    await Promise.all([
      page.getByTestId("copilotkit-v2-send").click(),
      second.getByTestId("copilotkit-v2-send").click(),
    ]);

    // ── 判据①：两条线程各自看到自己的回答 ──
    await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(markerA, { timeout: 180_000 });
    await expect(second.getByTestId("copilotkit-v2-messages")).toContainText(markerB, { timeout: 180_000 });

    // ── 判据②：各自**没有**对方的东西（串线在①下恒绿，这一条才是本用例的核心）──
    await expect(
      page.getByTestId("copilotkit-v2-messages"),
      "A 线程里出现了 B 线程的标记 = 并发时事件流按 agent 而不是按 thread 归拢",
    ).not.toContainText(markerB);
    await expect(second.getByTestId("copilotkit-v2-messages")).not.toContainText(markerA);

    // ── 判据③：权威读复核，两次 run 是两个独立 run，落库互不污染 ──
    const storedA = await storedMessages(page, threadA);
    const storedB = await storedMessages(second, threadB);
    expect(storedA.some((message) => message.text.includes(markerB)), "A 线程落库里混进了 B 的内容").toBe(false);
    expect(storedB.some((message) => message.text.includes(markerA)), "B 线程落库里混进了 A 的内容").toBe(false);

    const answerA = storedA.find((message) => message.authorKind === "agent" && message.text.includes(markerA));
    const answerB = storedB.find((message) => message.authorKind === "agent" && message.text.includes(markerB));
    expect(answerA, "A 线程必须落库一条自己的回答").toBeDefined();
    expect(answerB, "B 线程必须落库一条自己的回答").toBeDefined();
    expect(answerA!.agentRunId, "两条线程必须是两次独立的 run").not.toBe(answerB!.agentRunId);
  } finally {
    await second.close();
  }
});
