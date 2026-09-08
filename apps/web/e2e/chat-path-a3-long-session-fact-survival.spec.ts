import { expect, test } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { login, sendInV2AndAwaitStoredReply, storedMessages } from "./support/chat-path-coverage";
import { selectWorkbenchAgent } from "./support/workbench-run-evidence";

/**
 * 路径矩阵 **A3 · 长会话压缩**（判据见 `.harness/instructions/chat-path-coverage-matrix.md`）。
 *
 * ## 这条与 `context-engine.spec.ts` 的 L2 用例不是同一件事
 *
 * 那条断言的是 `l2SummaryEchoPrefix`——**摘要伪消息这个结构**真的到达了模型输入。
 * 一个把历史压成「用户聊了一些事」的摘要器照样让它绿：结构在、事实没了。
 * 长会话压缩唯一会伤到用户的失效形态恰恰是后者——「聊到第 30 轮，它忘了第 1 轮
 * 说的项目代号」。本条断言的是那个**具体事实**（`l2EarlyFactCodeWord`，种子脚本埋在
 * 这条线程最早一条消息里、早已被 30 条填充轮次挤出 L1）真的活着穿过了压缩层。
 *
 * 两条断言在同一次回复里各自独立可读（`[l2-summary-seen:]` 与 `[l2-fact-seen:]` 两个
 * 前缀），所以这不是把同一个事实声明第二遍：结构在 ∧ 事实在 是两个信号，前者为真、
 * 后者为假是一个**真实可发生**的状态（摘要器工作但摘丢了关键事实），而那正是本条要挡的。
 *
 * ## 为什么这条断言不可能靠"假装"蒙混
 *
 * 确定性上游（`loopback-model-provider.ts` 的 `l2FactSurvivedCompaction`）只在**它自己
 * 收到的那条 `[早前对话摘要] ...` 伪消息正文里**真的看到那个代号时才回显。压缩层
 * 丢掉早期事实 ⇒ 伪消息正文里没有代号 ⇒ 回显不出现 ⇒ 本条如实红。
 *
 * ## 为什么挂 `test.fixme`：产品缺口 #3028，不是断言写错
 *
 * 本条要证的事需要两件同时成立：① 在**种好 30 条填充轮次的那条线程**里跑；
 * ② 这一轮走 `CHAT_READ_E2E.agentId`（loopback-echo）——只有它会回显 L2 的那两个哨兵。
 * 而 v2 上这两件事互斥（#3028）：深链进那条线程用的是服务端默认 agent（deep-agent，
 * 没有这些回显）；切到 `agentId` 又会因 `copilotkit-v2-panel.tsx` 的
 * `key={selectedAgentId}` 卸载当前对话、开一条全新的空线程，种好的历史随之消失。
 *
 * 这与 `context-engine.spec.ts` 的 L2/F190 两条撞的是**同一个**缺口，那两条已按人类
 * 裁决（issue #2997 方案 B）挂 `test.fixme`：不删断言、不改宽、不 `test.skip`。本条
 * 沿用同一处置——正文就是补上 #3028 之后可以直接跑的版本，届时把 `test.fixme` 改回
 * `test` 即可，一个字都不用动。
 *
 * ## 边界诚实
 *
 * 上游是确定性替身，它的"摘要"是回显而不是真实语义压缩——本条证的是
 * **压缩链路会把早期区间的正文真的喂给摘要器、并把摘要结果原样带回下一轮**，
 * 不是"真实模型的摘要质量好"。后者需要真实模型凭据，见
 * `.harness/instructions/real-model-e2e.md` 的车道划分，不在本条范围内。
 */
test.setTimeout(180_000);

test.fixme("@path:A3 长会话压缩：被挤出 L1 的早期事实真的活着穿过摘要层", async ({ page }) => {
  await login(page);
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.restructureProjectId}&thread=${CHAT_READ_E2E.l2CheckThreadId}`);
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible({ timeout: 120_000 });
  // #3028 补上之后，这一行才能既留在种好的线程里、又切到回显 agent。
  await selectWorkbenchAgent(page, CHAT_READ_E2E.agentId);

  // ① 结构：摘要伪消息到达了模型输入（本条的前提，不是结论——它为真而 ② 为假，
  //    正是本条要暴露的那个状态）。
  await sendInV2AndAwaitStoredReply(
    page,
    CHAT_READ_E2E.l2CheckThreadId,
    "接着上面聊，早前定下的那个代号还作数吗？",
    CHAT_READ_E2E.l2SummaryEchoPrefix,
  );

  // ② 事实：那个具体代号真的还在摘要正文里。读落库消息，不读渲染的那一帧。
  const messages = await storedMessages(page, CHAT_READ_E2E.l2CheckThreadId);
  const fact = `${CHAT_READ_E2E.l2FactEchoPrefix}${CHAT_READ_E2E.l2EarlyFactCodeWord}`;
  const survived = messages.some((message) => message.authorKind === "agent" && message.text.includes(fact));
  expect(
    survived,
    `长会话压缩后，早期事实代号 ${CHAT_READ_E2E.l2EarlyFactCodeWord} 必须仍在摘要正文里——`
    + "结构在、事实没了，正是用户唯一会察觉到的那种压缩失效",
  ).toBe(true);
});
