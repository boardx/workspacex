/**
 * #1324 —— 复核重构：把原来一条 27 秒的大用例（#1310/PR #1314）拆成三条独立、
 * 各自专属线程的 spec。
 *
 * ## 为什么重构（复核意见，逐字摘录判分）
 *
 * 一次外部复核指出：原用例证明了「skill 挂载能落库、刷新后可见」和「文件检索进了模型
 * 输入」，但两件事之间**没有因果断言**——挂载的 skill 是否真的参与了那次 run，测试从未
 * 证明。打分：检索链路 7/10；skill 实际生效证明 2/10；综合 5/10。
 *
 * coord-main 独立复核确认这不只是测试盲区，是**真实产品缺口**，已单独开 #1322 追踪：
 * `execute-run.ts` 的 `run.skillVersionIds` 只来自已发布 agent 版本
 * （`agent_versions.skill_version_ids`），全仓 `thread_skill_mounts`/`ThreadMountStore`
 * 在 agent-run 构建路径零命中——线程级临时挂载事实上不影响任何一次真实 run。
 *
 * 🔴 **本文件不修 #1322**。这里只做人类在 #1324 上要求的测试重构本身：
 *   1. 三个关注点（挂载持久化 / 挂载-运行因果对照 / 检索命中对照）拆成三条独立 `test()`，
 *      各自一条**零预置消息**的专属线程（见 `chat-read-fixture.ts` 的
 *      `skillMountThreadId`/`causalCheckThreadId`/`contextCheckThreadId`），不再共享
 *      51 条消息的 `threadId` 夹具、不靠 `chat-messages-load-more` 翻页定位——原用例的
 *      失败定位差正是这一点造成的（翻页 + 51 条历史 + 一条大用例三件事绑在一起）。
 *   2. 挂载→运行因果对照那条**如实断言现状**（挂载前后 `skillVersionIds` 无差异），
 *      不装作 #1322 已经修好——见该测试自己的大注释。
 *
 * ## 上游依旧是确定性替身
 *
 * 真登录、真 API、真 Postgres、真浏览器，不 mock：模型上游是确定性替身
 * `loopback-model-provider.ts`（真实 `ConfiguredModelProvider` 适配器走真实 HTTP，
 * 只是上游可预测），不是在前端拦一个假响应。
 *
 * ## 范围诚实（延续原文件的三条边界，本次重构未改变它们）
 *
 * · **F63（把 skill 绑定到议程环节 / 套用工作流模板）今天没有端到端路径**——
 *   它的唯一可写端口 `ProjectOrchestrationStorePort` 零适配器，本文件不覆盖。
 * · **本文件不证明「skill 改变了模型的回答」。** 上游是确定性替身，没有真实模型语义。
 *   下面第二条测试能证明的，也只是「挂载是否影响了 run 快照里的 `skillVersionIds`
 *   这个结构性字段」——不是语义、不是回答质量。
 * · 断言的是**性质**不是字面值：不断言召回正文逐字相等、不断言消息条数、不断言回复措辞。
 */
import { expect, test, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
// ⚠ 从产品代码 import 那个 key，不在这里再写一份字面量——鉴权是
//   `Authorization: Bearer <token>`（不是 cookie），token 存在 localStorage 的这个键下。
//   抄一份副本就是本仓多次记录过的漂移形状（见 `skill-review-gate.spec.ts` 同一模式）。
import { SESSION_TOKEN_STORAGE_KEY } from "../lib/api-client";

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

/** `page.request` 不会自动带上身份（Bearer，不是 cookie）——直连 API 时要显式带这个头。 */
async function authHeaders(page: Page): Promise<Record<string, string>> {
  const token = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_TOKEN_STORAGE_KEY);
  expect(token, "登录之后 localStorage 里应有 session token").toBeTruthy();
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

/**
 * 发一条消息，等服务端确认已排队（202 + `runId`），返回这次 `AgentRun` 的 id。
 *
 * 不在这里等到终态——两条测试对「终态」的取证方式不同（因果对照那条要读
 * `skillVersionIds`，只能走 API；context 对照那条走 UI 的 `data-run-status`），
 * 所以终态等待留给各自的调用方。
 */
async function sendMessage(page: Page, threadId: string, text: string): Promise<string> {
  const input = page.getByRole("textbox", { name: "消息内容" });
  await expect(input).toBeVisible();
  await input.fill(text);

  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().endsWith(`/chat/threads/${threadId}/messages`)
  ));
  await page.getByTestId("chat-message-submit").click();
  const response = await responsePromise;
  expect(response.status()).toBe(202);
  const body = await response.json() as { agentRunId: string; runStatus: string };
  expect(body.runStatus).toBe("queued");
  await expect(page.getByTestId("chat-message-queued")).toBeVisible();
  return body.agentRunId;
}

/** 挂一个 skill 到当前线程，等它出现在挂载列表里。三条测试里有两条要做这同一个动作。 */
async function mountSkill(page: Page, threadId: string): Promise<void> {
  const mountResponse = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().includes(`/threads/${threadId}/skill-mounts`)
  ));
  // 「加 skill」在版本号读到之前是禁用的（拒绝盲写），所以这里等它可点而不是硬点。
  await expect(page.getByTestId("chat-skill-mount")).toBeEnabled();
  await page.getByTestId("chat-skill-mount").click();
  await expect(page.getByTestId("chat-skill-mount-picker")).toBeVisible();
  await page.getByTestId(`chat-skill-mount-option-${CHAT_READ_E2E.mountableSkillId}`).click();
  expect((await mountResponse).ok()).toBe(true);
  await expect(page.getByTestId(`chat-skill-mounted-${CHAT_READ_E2E.mountableSkillId}`)).toBeVisible();
}

/**
 * 直连 `GET /agent-runs/:runId`，轮询到终态（`succeeded`/`failed`，见 `AgentRunStatus`
 * 契约），返回完整投影（含 `skillVersionIds`）。
 *
 * 用直连 API 而不是 UI 的 `data-run-status`：`skillVersionIds` 从未被投影到任何
 * data-testid 上（`chat-live-agent-run-status` 只暴露 `status`/`resultMessageId`），
 * 这条契约字段本来就只在这个响应体里——直接读它，不新增任何产品侧的 UI 暴露面，
 * 也不需要为了取证而改 `execute-run.ts`（那是 #1322 的范围，本文件不碰）。
 */
async function pollRunToTerminal(
  page: Page,
  headers: Record<string, string>,
  runId: string,
): Promise<{ status: string; skillVersionIds: readonly string[] }> {
  let last: { status: string; skillVersionIds: readonly string[] } | null = null;
  await expect.poll(async () => {
    const res = await page.request.get(`/agent-runs/${runId}`, { headers });
    expect(res.ok(), `GET /agent-runs/${runId} 应返回 2xx`).toBe(true);
    const projection = await res.json() as { status: string; skillVersionIds: readonly string[] };
    last = projection;
    // 只有 queued/running/writeback_pending 这三个非终态才继续轮询；succeeded/failed
    // 都停下——「恰好 succeeded」这条更严格的断言留给调用方做，这里只负责等到终态。
    return projection.status === "succeeded" || projection.status === "failed";
  }, { timeout: 60_000 }).toBe(true);
  expect(last, "轮询结束时应该已经拿到过至少一次响应").not.toBeNull();
  return last!;
}

/* ═══════════════════════════ ① F65：挂载持久化与刷新 ═══════════════════════════ */

test("F65：会话内临时挂载一个 skill，落库且刷新后仍在", async ({ page }) => {
  await login(page);
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.restructureProjectId}&thread=${CHAT_READ_E2E.skillMountThreadId}`);
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.skillMountThreadId}`))
    .toContainText("Skill mount check fixture thread");

  const panel = page.getByTestId("chat-skill-mount-panel");
  await expect(panel).toBeVisible();
  // 前提：现在一个都没挂。没有这条，下面「挂上了」的断言可能一开始就是真的。
  await expect(page.getByTestId("chat-skill-mount-empty")).toBeVisible();

  await mountSkill(page, CHAT_READ_E2E.skillMountThreadId);

  // 挂载列表即时更新（F65 的可见行为：输入区上方的挂载角标）。
  await expect(page.getByTestId("chat-skill-mount-empty")).toHaveCount(0);
  await expect(page.getByTestId("chat-skill-mount-failure")).toHaveCount(0);

  /* ⚠ 关键一步：刷新丢掉全部前端状态，再读一次服务端。
   *   不刷新的话，`useState` 里的一个数组就能让界面看起来是对的——
   *   只有真的写进了 `thread_skill_mounts` 才活得过这一下。 */
  await page.reload();
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.skillMountThreadId}`))
    .toContainText("Skill mount check fixture thread");
  await expect(page.getByTestId(`chat-skill-mounted-${CHAT_READ_E2E.mountableSkillId}`)).toBeVisible();
});

/* ══════════════ ② 挂载→运行因果对照——如实反映 #1322 这个真实缺口 ══════════════ */

test("挂载前后同一 agent 的 run，skillVersionIds 无因果差异（#1322 已知缺口，本条如实断言现状）", async ({ page }) => {
  await login(page);
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.restructureProjectId}&thread=${CHAT_READ_E2E.causalCheckThreadId}`);
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.causalCheckThreadId}`))
    .toContainText("Causal check fixture thread");

  const headers = await authHeaders(page);

  // 挂载前：发一条消息，记录这次 run 的 skillVersionIds。
  const beforeRunId = await sendMessage(page, CHAT_READ_E2E.causalCheckThreadId, "挂载前：第一条取证消息");
  const beforeRun = await pollRunToTerminal(page, headers, beforeRunId);
  expect(beforeRun.status, "挂载前这次 run 应该正常跑到 succeeded，不是本条要测的东西红在别处").toBe("succeeded");

  // 挂一个 skill 到这条线程（与①同一个 F65 动作，这里只是构造因果对照的前置条件）。
  await mountSkill(page, CHAT_READ_E2E.causalCheckThreadId);

  // 挂载后：再发一条消息，同样记录这次 run 的 skillVersionIds。
  const afterRunId = await sendMessage(page, CHAT_READ_E2E.causalCheckThreadId, "挂载后：第二条取证消息");
  const afterRun = await pollRunToTerminal(page, headers, afterRunId);
  expect(afterRun.status, "挂载后这次 run 也应该正常跑到 succeeded").toBe("succeeded");

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * 🔴 已知缺口 #1322——这条断言的方向是"当前确实没有因果关系"，不是"挂载生效了"。
   *
   * `execute-run.ts` 的 `run.skillVersionIds` 只来自已发布 agent 版本快照
   * （`agent_versions.skill_version_ids`，本夹具种的是空数组），线程级临时挂载
   * （`thread_skill_mounts`）从未进入这条构建路径。所以挂载前、挂载后两次 run 的
   * `skillVersionIds` 现在**必然相等**（都是 `[]`）——这不是本条测试的 bug，
   * 是产品今天真实的样子。
   *
   * ⚠⚠ #1322 修复后，这条断言的方向需要**反过来**：改成断言
   *   `afterRun.skillVersionIds` 包含挂载那个 skill 的 version id、且与
   *   `beforeRun.skillVersionIds` 不同——到那时删掉这段大注释和下面这条
   *   `toEqual`，换成不等/包含断言。**在那之前，这条测试必须保持现在这个方向**：
   *   如果有人不小心提前把 thread mount 接进了 run 构建路径（哪怕只是意外的
   *   副作用），这条测试会因为断言方向不对而失败，逼着人回来看，而不是静默通过。
   * ═══════════════════════════════════════════════════════════════════════════
   */
  expect(beforeRun.skillVersionIds, "#1322：agent 未发布任何 skill version，挂载前应为空").toEqual([]);
  expect(
    afterRun.skillVersionIds,
    "#1322 已知缺口：线程临时挂载当前不影响 run 的 skillVersionIds，这里如实断言挂载前后相等",
  ).toEqual(beforeRun.skillVersionIds);
});

/* ═══════════════════════════ ③ F155：context 命中/未命中对照 ═══════════════════════════ */

test("F155：命中项目内可检索文件的提问带来源标记，未命中的不带", async ({ page }) => {
  await login(page);
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.restructureProjectId}&thread=${CHAT_READ_E2E.contextCheckThreadId}`);
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.contextCheckThreadId}`))
    .toContainText("Context check fixture thread");

  const status = page.getByTestId("chat-live-agent-run-status");

  async function sendAndAwaitRun(text: string): Promise<string> {
    await sendMessage(page, CHAT_READ_E2E.contextCheckThreadId, text);
    // 终态：succeeded。⚠ 断言的是**恰好 succeeded**，不是「不再是 queued」——
    // failed 也不再是 queued，放宽成后者会让一条整体失败的 run 也算通过。
    await expect
      .poll(async () => status.getAttribute("data-run-status"), { timeout: 60_000 })
      .toBe("succeeded");
    await expect
      .poll(async () => status.getAttribute("data-result-message-id"), { timeout: 60_000 })
      .not.toBeNull();
    const resultMessageId = await status.getAttribute("data-result-message-id");
    expect(resultMessageId, "写回提交后必须能拿到回复消息 id").toBeTruthy();
    return resultMessageId as string;
  }

  // 这条线程是专属、零预置消息的夹具（见文件头），发出去的消息天然落在第一页，
  // 定位回复不需要任何翻页逻辑——这正是 #1324 重构要解决的失败定位问题。
  function messageRow(messageId: string) {
    // ⚠ 必须同时锚 `chat-message-row`：`data-message-id` 在同一条消息里挂在**三个**
    //   元素上（消息行本身、复制按钮、评分块），只按它选会 strict mode violation。
    return page.locator(`[data-testid="chat-message-row"][data-message-id="${messageId}"]`);
  }

  /* ═══════════ 反向对照先跑：不命中任何文件的提问 ═══════════
   *
   * 顺序是判据的一部分，必须排在命中那一轮之前：命中那轮的回复文本里会含有来源标记，
   * 而它随后就成了 L1 近端历史的一部分。先跑对照，就不存在「上一轮的回显污染这一轮」
   * 这种解释空间。（替身那侧还另有一道防线：只认以 L3 伪消息头开头的 assistant 消息，
   * 见 `loopback-model-provider.ts` 的 `retrievedSourceKinds`。两道各自独立。） */
  const decoyMessageId = await sendAndAwaitRun(CHAT_READ_E2E.retrievalDecoyQuery);
  const decoyReply = messageRow(decoyMessageId);
  // 这条回复真的出自确定性上游（带回显前缀）⇒ 闭环穿过了整条链，不是前端合成的。
  await expect(decoyReply).toBeVisible();
  await expect(decoyReply).toContainText(CHAT_READ_E2E.agentReplyPrefix);
  await expect(
    decoyReply,
    "没有命中任何文件时，回复里不该出现检索来源标记——否则下面那条命中断言恒绿、证明不了任何事",
  ).not.toContainText(CHAT_READ_E2E.retrievalEchoPrefix);

  /* ═══════════ 命中项目内可检索文件的提问 ═══════════
   *
   * 断言的是**结构性质**：那条召回伪消息**带着来源标记 `chat-attachment`** 真的到达了
   * 模型输入。不断言召回正文逐字相等（那是把断言绑死在种子文案上），也不断言命中份数。
   *
   * ⚠ 边界诚实：这证明的是「检索内容真的到达了 provider」，不是「真实模型用上了
   *   context」，也不是「skill 改变了回答」——上游是确定性替身，没有真实模型语义，
   *   这条边界不因为拆了文件就变宽。
   *
   * 这条断言为什么不可能靠「假装检索」蒙混：回显出自**上游进程**，它只在自己收到的
   * history 里真的存在一条以 L3 伪消息头开头、且含来源标记的 assistant 消息时才写这一段。
   * 检索坏掉 ⇒ 不注入伪消息 ⇒ 上游收不到 ⇒ 回复里没有这一段 ⇒ 本条如实红。 */
  const groundedQuestion = `${CHAT_READ_E2E.retrievalTerm} 的回滚窗口是多久？`;
  const groundedMessageId = await sendAndAwaitRun(groundedQuestion);
  const groundedReply = messageRow(groundedMessageId);
  await expect(groundedReply).toBeVisible();
  await expect(groundedReply).toContainText(CHAT_READ_E2E.agentReplyPrefix);
  await expect(
    groundedReply,
    "命中的文件应作为带来源标记的检索上下文进入模型输入（F155：来源标记 chat-attachment）",
  ).toContainText(CHAT_READ_E2E.retrievalEchoPrefix);
  // 来源标记本身是 F155 的封闭枚举值（`FileRetrievalSourceKind`），断言它而不是断言正文：
  // 这是「这段上下文是从哪一类文件来的」这一契约性质，不是某份种子文件的内容。
  await expect(groundedReply).toContainText("chat-attachment");

  /* ═══════════ 结果真的落在这条对话里 ═══════════
   *
   * 刷新一次再看：回复不是渲染在内存里的一帧，是写回了库、重读得回来的一条消息。 */
  await page.reload();
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.contextCheckThreadId}`))
    .toContainText("Context check fixture thread");
  const persistedReply = messageRow(groundedMessageId);
  await expect(persistedReply).toBeVisible();
  // 来源标记也是重读回来的，不是上一帧留在内存里的。
  await expect(persistedReply).toContainText(CHAT_READ_E2E.retrievalEchoPrefix);
});
