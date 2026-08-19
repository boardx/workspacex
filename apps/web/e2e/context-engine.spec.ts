/**
 * context engine 浏览器端到端反证 —— L2 滚动摘要 与 F190 工具调用轨迹回喂两层
 * **此前从未被任何浏览器 e2e 走过**的部分。真登录、真 API、真 Postgres、真浏览器，
 * 不 mock：模型上游是确定性替身 `loopback-model-provider.ts`，同
 * `chat-agent-skill-context.spec.ts` 的既有纪律。
 *
 * ## 为什么只测这两层，不是把 L1/L3/F156 也搬进来重做一遍
 *
 * · **L1（近端原文）**：`chat-agent-skill-context.spec.ts` 的三条用例早就在真实浏览器里
 *   反复发消息、读回复——history 里必须真的带着此前的轮次，这件事本来就是那些用例
 *   能通过的前提，不需要再单独证一次"L1 存在"。
 * · **L3（文件式检索）**：同一个文件的第三条用例（`F155：命中项目内可检索文件的提问
 *   带来源标记，未命中的不带`）已经在真实浏览器里做过命中/未命中对照，本文件不重复。
 * · **F156（个人对话零跨范围召回）**：`chat-read.spec.ts` 的
 *   `formal Chat with no projectId goes personal, never invents a project context`
 *   已经在真实浏览器里证明个人模式走独立端口、不向任何伪造的项目路径发请求；硬边界
 *   `cross_scope_retrieval_requests == 0` 本身在 `apps/api/tests/chat/personal-thread-
 *   zero-retrieval.test.ts` 有真库反证——这条不变量没有浏览器可观察的信号（不落地
 *   任何 DOM），重新在浏览器层复述一遍不会增加证明力，只会多起一次栈。
 *
 * 唯一没有任何既有 e2e（浏览器或 API 级）覆盖过的，是"L2/F190 这两层组装出的伪消息
 * 真的到达了浏览器发起的那次真实 run 的模型输入"——这是本文件唯一要补的证据。
 *
 * ## 前置条件：为什么两条线程都不是"零预置消息"
 *
 * 与本目录其它专属线程不同，`l2CheckThreadId`/`toolTraceCheckThreadId` 由种子脚本
 * 灌入了足够多撑满字符预算的填充消息（`seed-chat-read-e2e.ts`），把"早期事实"/
 * "历史工具调用"挤出 L1 近端窗口——不这样做，用例发的那条消息看到的会是 L1 原文
 * 本身，测不出 L2/F190 这两条**独立于 L1 之外**的回喂路径。
 *
 * ## 边界诚实
 *
 * 断言的是"这一层的伪消息结构真的到达了模型输入"，不是"模型因此答得更好"——
 * 上游是确定性替身，没有真实模型语义，同本目录其它 context 相关用例的既有边界。
 */
import { expect, test, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

/** 发一条消息，等这次 run 走到终态（succeeded），返回它写回的那条消息所在行。 */
async function sendAndAwaitReply(page: Page, text: string) {
  const input = page.getByRole("textbox", { name: "消息内容" });
  await expect(input).toBeVisible();
  await input.fill(text);

  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && /\/chat\/threads\/[^/]+\/messages$/.test(response.url())
  ));
  await page.getByTestId("chat-message-submit").click();
  const response = await responsePromise;
  expect(response.status()).toBe(202);

  const status = page.getByTestId("chat-live-agent-run-status");
  await expect
    .poll(async () => status.getAttribute("data-run-status"), { timeout: 60_000 })
    .toBe("succeeded");
  await expect
    .poll(async () => status.getAttribute("data-result-message-id"), { timeout: 60_000 })
    .not.toBeNull();
  const resultMessageId = await status.getAttribute("data-result-message-id");
  expect(resultMessageId, "写回提交后必须能拿到回复消息 id").toBeTruthy();
  // ⚠ 必须同时锚 `chat-message-row`：`data-message-id` 在同一条消息里挂在三个元素上
  //   （消息行本身、复制按钮、评分块），只按它选会 strict mode violation。
  return page.locator(`[data-testid="chat-message-row"][data-message-id="${resultMessageId}"]`);
}

test("L2：滚动摘要伪消息真的到达了浏览器发起的这次 run 的模型输入", async ({ page }) => {
  await login(page);
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.restructureProjectId}&thread=${CHAT_READ_E2E.l2CheckThreadId}`);
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.l2CheckThreadId}`))
    .toContainText("L2 rolling summary check fixture thread");

  /*
   * 这条线程种了一条带代号的"早期事实" + 30 条撑满字符预算的填充轮次（见种子脚本），
   * 早期事实早就被挤出 L1。发这一条消息触发的 run 若真的走了 L2 增量摘要，
   * `execute-run.ts` 会把 `[早前对话摘要] ...` 伪消息前置进 history——确定性上游只在
   * 自己收到的 history 里真的看到这条以该前缀开头的 assistant 消息时，才把
   * `l2SummaryEchoPrefix` 回显进回复（`loopback-model-provider.ts`）。
   *
   * 这条断言不可能靠"假装摘要"蒙混：L2 坏掉 ⇒ 不前置摘要伪消息 ⇒ 上游收不到 ⇒
   * 回复里没有这一段 ⇒ 本条如实红。
   */
  const reply = await sendAndAwaitReply(page, "帮我回顾一下这条对话早期聊过什么");
  await expect(reply).toBeVisible();
  await expect(reply).toContainText(CHAT_READ_E2E.agentReplyPrefix);
  await expect(
    reply,
    "L2：30 条填充轮次早已撑爆 L1 的字符预算，这次 run 必然触发增量摘要，"
    + "摘要伪消息必须真的到达模型输入",
  ).toContainText(CHAT_READ_E2E.l2SummaryEchoPrefix);

  /* 落库复核：刷新一次，回复不是渲染在内存里的一帧。 */
  await page.reload();
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.l2CheckThreadId}`))
    .toContainText("L2 rolling summary check fixture thread");
  await expect(reply).toContainText(CHAT_READ_E2E.l2SummaryEchoPrefix);

  /*
   * 可用性补口：这次 run 真实组装出的 L1/L2/L3/F190 四层结构，此前对用户完全不可见
   * （F157 快照落地时只接了写，没有任何 HTTP 端点或 UI 消费过它）。这里断言的是
   * `GET /agent-runs/:runId/context-snapshot` 接的这枚徽标真的读到了**这次 run**
   * 自己的快照——不是一个恒定的占位文案：L2 状态必须显示"正常"（这次 run 确实触发
   * 了增量摘要，同上面 `l2SummaryEchoPrefix` 那条回显是同一件事的两个独立证据）。
   */
  const snapshotToggle = reply.getByTestId("context-snapshot-toggle");
  await expect(snapshotToggle).toBeVisible();
  await snapshotToggle.click();
  const snapshotDetail = reply.getByTestId("context-snapshot-detail");
  await expect(snapshotDetail).toBeVisible();
  await expect(snapshotDetail).toContainText("正常");
});

test("F190：跨 run 的历史工具调用轨迹真的回喂进了浏览器发起的下一次 run", async ({ page }) => {
  await login(page);
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.restructureProjectId}&thread=${CHAT_READ_E2E.toolTraceCheckThreadId}`);
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.toolTraceCheckThreadId}`))
    .toContainText("Tool trace cross-run check fixture thread");

  /*
   * 这条线程种了一轮"历史工具调用"（`tool_name`/`tool_result_summary` 落在
   * `agent_run_steps`，见种子脚本），随后 30 条填充轮次把它的回复消息挤出 L1——
   * 下一轮真实浏览器提问看到这段历史的**唯一**路径是 F190 的工具轨迹回喂，不是
   * L1 原文（L1 原文里那条回复只有"（历史工具调用的回复）"这句无信息量的占位文本，
   * 代号 `TOOL_TRACE_RESULT_CODE` 只存在于 `tool_result_summary`，从不在正文里）。
   *
   * 确定性上游只在自己收到的 history 里真的看到一条以工具轨迹伪消息头开头、且**正文
   * 包含那个具体代号**的 assistant 消息时，才回显 `toolTraceEchoPrefix`
   * （`loopback-model-provider.ts` 的 `toolTraceReachedModel`）——不是"看到某条随便
   * 什么样子的工具轨迹伪消息"就回显，弱证明力的版本在这里不成立。
   *
   * 这条断言不可能靠"假装回喂"蒙混：F190 坏掉 ⇒ 不前置工具轨迹伪消息 ⇒ 上游收不到
   * 那个具体代号 ⇒ 回复里没有这一段 ⇒ 本条如实红。
   */
  const reply = await sendAndAwaitReply(page, "你刚才用工具查到的那个代号是什么？");
  await expect(reply).toBeVisible();
  await expect(reply).toContainText(CHAT_READ_E2E.agentReplyPrefix);
  await expect(
    reply,
    "F190：历史轮次的工具调用记录（已被挤出 L1）必须经工具轨迹回喂路径到达模型输入，"
    + "且正文必须带着那次调用的具体结果代号，不是一条空壳伪消息",
  ).toContainText(CHAT_READ_E2E.toolTraceEchoPrefix);

  /* 落库复核：刷新一次，回复不是渲染在内存里的一帧。 */
  await page.reload();
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.toolTraceCheckThreadId}`))
    .toContainText("Tool trace cross-run check fixture thread");
  await expect(reply).toContainText(CHAT_READ_E2E.toolTraceEchoPrefix);

  /*
   * 可用性补口：这次 run 的可审计快照必须能被用户在界面上展开看到，且真实反映
   * "回喂了 1 轮工具轨迹"这件事——不是一个恒定不变的占位徽标。
   */
  const snapshotToggle = reply.getByTestId("context-snapshot-toggle");
  await expect(snapshotToggle).toBeVisible();
  await snapshotToggle.click();
  const snapshotDetail = reply.getByTestId("context-snapshot-detail");
  await expect(snapshotDetail).toBeVisible();
  await expect(snapshotDetail).toContainText("回喂 1 轮");
});
