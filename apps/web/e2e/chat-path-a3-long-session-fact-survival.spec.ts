import { expect, test } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { awaitProjectThreadReply, login, sendOnProjectThread } from "./support/chat-path-coverage";

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
 * ## 边界诚实
 *
 * 上游是确定性替身，它的"摘要"是回显而不是真实语义压缩——本条证的是
 * **压缩链路会把早期区间的正文真的喂给摘要器、并把摘要结果原样带回下一轮**，
 * 不是"真实模型的摘要质量好"。后者需要真实模型凭据，见
 * `.harness/instructions/real-model-e2e.md` 的车道划分，不在本条范围内。
 */
test.setTimeout(180_000);

test("@path:A3 长会话压缩：被挤出 L1 的早期事实真的活着穿过摘要层", async ({ page }) => {
  await login(page);
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.restructureProjectId}&thread=${CHAT_READ_E2E.l2CheckThreadId}`);
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.l2CheckThreadId}`))
    .toContainText("L2 rolling summary check fixture thread");

  await sendOnProjectThread(page, CHAT_READ_E2E.l2CheckThreadId, "接着上面聊，早前定下的那个代号还作数吗？");
  const reply = await awaitProjectThreadReply(page);
  await expect(reply).toBeVisible();
  await expect(reply).toContainText(CHAT_READ_E2E.agentReplyPrefix);
  const messages = reply;

  // ① 结构：摘要伪消息到达了模型输入（与 context-engine 那条同一个信号，这里是本条的前提，
  //    不是结论——它为真而 ② 为假，正是本条要暴露的那个状态）。
  await expect(
    messages,
    "L2 摘要伪消息必须真的到达模型输入；这一条为假说明压缩层根本没跑，②的红没有诊断价值",
  ).toContainText(CHAT_READ_E2E.l2SummaryEchoPrefix, { timeout: 60_000 });

  // ② 事实：那个具体代号真的还在摘要正文里。
  await expect(
    messages,
    `长会话压缩后，早期事实代号 ${CHAT_READ_E2E.l2EarlyFactCodeWord} 必须仍在摘要正文里——`
    + "结构在、事实没了，正是用户唯一会察觉到的那种压缩失效",
  ).toContainText(`${CHAT_READ_E2E.l2FactEchoPrefix}${CHAT_READ_E2E.l2EarlyFactCodeWord}`, { timeout: 60_000 });

  // 落库复核：刷新一次，上面看到的不是渲染在内存里的一帧。
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(reply)
    .toContainText(`${CHAT_READ_E2E.l2FactEchoPrefix}${CHAT_READ_E2E.l2EarlyFactCodeWord}`, { timeout: 60_000 });
});
