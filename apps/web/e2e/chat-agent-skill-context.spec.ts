/**
 * #1310 —— 「agent / skill / context 配置 → 在 chat 里出结果」这条**主流程**的真栈端到端用例。
 *
 * 人类要求的「两条主流程 e2e 测试用例」的第二条。真登录、真 API、真 Postgres、真浏览器，
 * 不 mock：模型上游是确定性替身 `loopback-model-provider.ts`（真实 `ConfiguredModelProvider`
 * 适配器走真实 HTTP，只是上游可预测），不是在前端拦一个假响应。
 *
 * ## 这一条走完的一整条路
 *
 *   ① 选一个**真实可运行**的 agent（`agentId`，loopback-echo provider）
 *   ② F65：在这条对话里临时加一个 skill，**刷新后仍在**（落库，不是 useState）
 *   ③ F155：发一条命中项目内可检索文件的提问，来源标记随召回内容进了模型输入
 *   ④ AgentRun 从「已排队」真实流转到 `succeeded`，回复**落库并渲染**进消息列表
 *   ⑤ 反向对照：一条不命中任何文件的提问，回复里**没有**来源标记
 *
 * ## 范围诚实（三条，不许在报告里说成已覆盖）
 *
 * · **F63（把 skill 绑定到议程环节 / 套用工作流模板）今天没有端到端路径。**
 *   它的唯一可写端口 `ProjectOrchestrationStorePort` **零适配器**（本轮实测：全仓无任何
 *   `implements`，`skill-mount.controller.ts:20` 与 `list-thread-deviations.ts:12` 两处
 *   独立记着同一件事）。⇒ 它的 `verification` 是应用层 vitest，不是浏览器可达的东西。
 *   本用例覆盖的是**同一条主流程上今天真的接通的那一段**：F65 的线程级临时挂载。
 *   把 F63 硬写进来只能靠直接改库造出编排数据，那不是端到端，是给自己发一张假通行证。
 * · **本用例不证明「skill 改变了模型的回答」。** 上游是确定性替身，它没有真实模型语义，
 *   「挂了 skill 之后回答更好」这件事在这套编排里不可判定（见
 *   `.harness/instructions/chat-ux-acceptance-criteria.md` 记的同一条结构性限制）。
 *   能证明的是「挂载真的落库、并且真的作用在这条对话上」——那正是 F65 的可见行为本身。
 *   context 那一侧则**确实**证到了「起作用」：来源标记真的进了模型输入，且**只在命中时**进。
 * · 断言的是**性质**不是字面值：不断言召回正文逐字相等、不断言消息条数、不断言回复措辞。
 */
import { expect, test, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/** 两次 run + 首次编译，默认 120s 偏紧（同 config 头注记的那条首载慢的老问题）。 */
test.slow();

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

/**
 * 发一条消息，等这次 AgentRun 真的走到终态，返回它在界面上的**服务端状态**与回复文本。
 *
 * 「真实流转到完成」在这里由两个**服务端来源**的信号共同保证，而不是「loading 转完了」：
 *   · `chat-message-queued` —— POST 回 202 且带 runId 才渲染（排队态，服务端确认过）；
 *   · `data-run-status` —— 直接来自 `GET /agent-runs/:id` 的契约状态机原值；
 *   · `data-result-message-id` —— #413 的写回事务**提交后**才非空，
 *     即「恰好一条回复真的落库了」在 DOM 上的投影。
 * 三者都不是前端自己推断出来的。
 */
async function sendAndAwaitRun(page: Page, text: string): Promise<string> {
  const input = page.getByRole("textbox", { name: "消息内容" });
  await expect(input).toBeVisible();
  await input.fill(text);

  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().endsWith(`/chat/threads/${CHAT_READ_E2E.threadId}/messages`)
  ));
  await page.getByTestId("chat-message-submit").click();
  const response = await responsePromise;
  expect(response.status()).toBe(202);
  // ① 这条消息真的是发给那个**可运行**的 agent 的，不是发给目录里那个跑不动的。
  expect(response.request().postDataJSON()).toMatchObject({
    text,
    agentId: CHAT_READ_E2E.agentId,
  });

  // 排队态（服务端已持久化消息并建了 run）。
  await expect(page.getByTestId("chat-message-queued")).toBeVisible();

  // 终态：succeeded。⚠ 断言的是**恰好 succeeded**，不是「不再是 queued」——
  // failed 也不再是 queued，放宽成后者会让一条整体失败的 run 也算通过。
  const status = page.getByTestId("chat-live-agent-run-status");
  await expect
    .poll(async () => status.getAttribute("data-run-status"), { timeout: 60_000 })
    .toBe("succeeded");
  // 写回事务已提交 ⇒ 真的有一条回复落库了。
  await expect
    .poll(async () => status.getAttribute("data-result-message-id"), { timeout: 60_000 })
    .not.toBeNull();
  const resultMessageId = await status.getAttribute("data-result-message-id");
  expect(resultMessageId, "写回提交后必须能拿到回复消息 id").toBeTruthy();
  return resultMessageId as string;
}

/**
 * 把消息列表翻到能看见 `messageId` 那一条为止，返回它所在的行。
 *
 * ## 为什么按 **message id** 定位，而不是按回复文本
 *
 * 本轮实测（两次独立运行）撞出来的两件事，都指向「按文本找回复」是错的：
 *
 * ① **消息列表是游标分页的。** 夹具里已有 51 条，新产生的回复落在后续页上，不点
 *    `chat-messages-load-more` 就不在 DOM 里——run 明明已经 `succeeded` 且
 *    `data-result-message-id` 非空，首页却什么都找不到。这不是等待时间不够，
 *    加 timeout 永远等不到，所以这里是「翻页」不是「再等等」。
 * ② **确定性上游回显的不是本轮输入。** `loopback-model-provider.ts` 取的是
 *    `messages.find(role === "user")`，即 history 里**第一条** user 消息；在这条
 *    51 条消息的夹具线程上，它恒等于 `Controlled fixture message 01`。
 *    ⇒ 「回复里回显了我刚发的那句话」在**这条**线程上根本不成立（在 core-loop 那种
 *    新建线程上才成立，那里 history 只有一条）。照那个假设写断言，会得到一条
 *    永远找不到目标的测试，而失败信息看起来却像「回复没写回」——正是本仓
 *    `static-trace-vs-live-fact.md` 说的那种会骗人的失败。
 *
 * `data-result-message-id` 来自 `GET /agent-runs/:id`，是**这一次 run 的写回事务
 * 产生的那一条消息**的 id。按它定位，锚点既精确又与回复措辞无关。
 */
async function revealMessage(page: Page, messageId: string) {
  // ⚠ 必须同时锚 `chat-message-row`：`data-message-id` 在同一条消息里挂在**三个**元素上
  //   （消息行本身、复制按钮、评分块），只按它选会 strict mode violation（本轮实测）。
  const row = page.locator(`[data-testid="chat-message-row"][data-message-id="${messageId}"]`);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await row.count() > 0) break;
    const more = page.getByTestId("chat-messages-load-more");
    // ⚠ 先 count 再 click 之间有窗口：最后一页加载完按钮会消失，此时 click 会一直等到
    //   整条用例超时（本轮实测栽过一次，360s 全耗在这一行）。给它一个短超时并吞掉，
    //   循环下一轮会重新判断，不会把「没有更多页了」变成「测试挂死」。
    if (await more.count() === 0) break;
    await more.click({ timeout: 10_000 }).catch(() => {});
  }
  return row;
}

test("agent → skill → context：配置一个 agent 与 skill，检索命中的文件真的进了模型输入并产出可见回复", async ({ page }) => {
  await login(page);
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.threadId}`)).toContainText("Controlled fixture thread");

  /* ═══════════ ① 真实、可运行的 agent 在编制里 ═══════════
   *
   * ⚠ 刻意**不**用 `catalogOnlyAgentId`：那个 agent 只进了 `capability_listings`，
   *   没有 `agents`/`agent_versions` 的可执行版本，选它 run 会停在
   *   `AGENT_VERSION_UNAVAILABLE`，整条主流程根本走不到出结果那一步。
   *   这里显式断言两件事：能跑的那个在场、跑不动的那个不在场——
   *   后者保证下面 `sendAndAwaitRun` 里那条 `agentId` 断言不是碰巧成立。 */
  await expect(page.getByTestId(`chat-roster-agent-${CHAT_READ_E2E.agentId}`)).toBeVisible();
  await expect(page.getByTestId(`chat-roster-agent-${CHAT_READ_E2E.catalogOnlyAgentId}`)).toHaveCount(0);

  /* ═══════════ ② F65：在这条对话里临时加一个 skill ═══════════ */

  const panel = page.getByTestId("chat-skill-mount-panel");
  await expect(panel).toBeVisible();
  // 前提：现在一个都没挂。没有这条，下面「挂上了」的断言可能一开始就是真的。
  await expect(page.getByTestId("chat-skill-mount-empty")).toBeVisible();

  const mountResponse = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().includes(`/threads/${CHAT_READ_E2E.threadId}/skill-mounts`)
  ));
  // 「加 skill」在版本号读到之前是禁用的（拒绝盲写），所以这里等它可点而不是硬点。
  await expect(page.getByTestId("chat-skill-mount")).toBeEnabled();
  await page.getByTestId("chat-skill-mount").click();
  await expect(page.getByTestId("chat-skill-mount-picker")).toBeVisible();
  // 池子来自真实的 `GET /skills`，不是常量。种子那条「已启用」的必须真的在里面。
  await page.getByTestId(`chat-skill-mount-option-${CHAT_READ_E2E.mountableSkillId}`).click();
  expect((await mountResponse).ok()).toBe(true);

  // 挂载列表即时更新（F65 的可见行为：输入区上方的挂载角标）。
  await expect(page.getByTestId(`chat-skill-mounted-${CHAT_READ_E2E.mountableSkillId}`)).toBeVisible();
  await expect(page.getByTestId("chat-skill-mount-empty")).toHaveCount(0);
  await expect(page.getByTestId("chat-skill-mount-failure")).toHaveCount(0);

  /* ⚠ 关键一步：刷新丢掉全部前端状态，再读一次服务端。
   *   不刷新的话，`useState` 里的一个数组就能让界面看起来是对的——
   *   只有真的写进了 `thread_skill_mounts` 才活得过这一下。 */
  await page.reload();
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.threadId}`)).toContainText("Controlled fixture thread");
  await expect(page.getByTestId(`chat-skill-mounted-${CHAT_READ_E2E.mountableSkillId}`)).toBeVisible();

  /* ═══════════ ③ 反向对照先跑：不命中任何文件的提问 ═══════════
   *
   * 顺序是判据的一部分，**必须排在命中那一轮之前**：命中那轮的回复文本里会含有来源标记，
   * 而它随后就成了 L1 近端历史的一部分。先跑对照，就不存在「上一轮的回显污染这一轮」
   * 这种解释空间。（替身那侧还另有一道防线：只认以 L3 伪消息头开头的 assistant 消息，
   * 见 `loopback-model-provider.ts` 的 `retrievedSourceKinds`。两道各自独立。） */
  const decoyMessageId = await sendAndAwaitRun(page, CHAT_READ_E2E.retrievalDecoyQuery);
  const decoyReply = await revealMessage(page, decoyMessageId);
  // 这条回复真的出自确定性上游（带回显前缀）⇒ 闭环穿过了整条链，不是前端合成的。
  await expect(decoyReply).toBeVisible();
  await expect(decoyReply).toContainText(CHAT_READ_E2E.agentReplyPrefix);
  await expect(
    decoyReply,
    "没有命中任何文件时，回复里不该出现检索来源标记——否则第 ④ 步那条断言恒绿、证明不了任何事",
  ).not.toContainText(CHAT_READ_E2E.retrievalEchoPrefix);

  /* ═══════════ ④ F155：命中项目内可检索文件的提问 ═══════════
   *
   * 断言的是**结构性质**：那条召回伪消息**带着来源标记 `chat-attachment`** 真的到达了
   * 模型输入。不断言召回正文逐字相等（那是把断言绑死在种子文案上），也不断言命中份数。
   *
   * 这条断言为什么不可能靠「假装检索」蒙混：回显出自**上游进程**，它只在自己收到的
   * history 里真的存在一条以 L3 伪消息头开头、且含来源标记的 assistant 消息时才写这一段。
   * 检索坏掉 ⇒ 不注入伪消息 ⇒ 上游收不到 ⇒ 回复里没有这一段 ⇒ 本条如实红。 */
  const groundedQuestion = `${CHAT_READ_E2E.retrievalTerm} 的回滚窗口是多久？`;
  const groundedMessageId = await sendAndAwaitRun(page, groundedQuestion);

  const groundedReply = await revealMessage(page, groundedMessageId);
  await expect(groundedReply).toBeVisible();
  await expect(groundedReply).toContainText(CHAT_READ_E2E.agentReplyPrefix);
  await expect(
    groundedReply,
    "命中的文件应作为带来源标记的检索上下文进入模型输入（F155：来源标记 chat-attachment）",
  ).toContainText(CHAT_READ_E2E.retrievalEchoPrefix);
  // 来源标记本身是 F155 的封闭枚举值（`FileRetrievalSourceKind`），断言它而不是断言正文：
  // 这是「这段上下文是从哪一类文件来的」这一契约性质，不是某份种子文件的内容。
  await expect(groundedReply).toContainText("chat-attachment");

  /* ═══════════ ⑤ 结果真的落在这条对话里 ═══════════
   *
   * 刷新一次再看：回复不是渲染在内存里的一帧，是写回了库、重读得回来的一条消息。
   * 同时挂载列表仍在——整条主流程的两件配置（skill 挂载）与产出（回复）都持久。 */
  await page.reload();
  await expect(page.getByTestId(`chat-skill-mounted-${CHAT_READ_E2E.mountableSkillId}`)).toBeVisible();
  const persistedReply = await revealMessage(page, groundedMessageId);
  await expect(persistedReply).toBeVisible();
  // 来源标记也是重读回来的，不是上一帧留在内存里的。
  await expect(persistedReply).toContainText(CHAT_READ_E2E.retrievalEchoPrefix);
});
