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
 * ## 🟢 2026-08-18 / #1559：上面第 2 条的方向**已经反过来**
 *
 * #1322 记录的缺口由 #1559 完整确诊（`thread_skill_mounts` 的外键只认模型 B、运行时
 * 只读模型 A，两条路互斥）并已修复。第二条测试因此从「如实断言没有因果关系」改成
 * **真反证**：挂载前后各发一条消息，断言 run 快照真的多了那个版本，**并且**那个 skill
 * 的 `SKILL.md` 正文真的到达了模型（哨兵回显）。原注释里「修好后要把方向反过来」的
 * 指示已执行完毕，本行是它的落款。
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
 *   第二条测试（#1559 后）能证明两件事：run 快照里的 `skillVersionIds` 真的多了挂载的
 *   那个版本（结构），**以及**那个 skill 的 `SKILL.md` 正文真的出现在了模型收到的
 *   system prompt 里（链路）。它**不**证明模型因此答得更好——那需要真实模型语义，
 *   这条边界不因为反证变强而变宽。
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
  // 2026-08-19（#1589）：单独的 `chat-message-queued` 回执已删（与 `chat-live-agent-run-status`
  // 同屏重复说同一件事）——排队态改盯这条状态条本身。
  await expect(page.getByTestId("chat-live-agent-run-status")).toBeVisible();
  return body.agentRunId;
}

/**
 * 挂一个 skill 到当前线程，等它出现在挂载列表里；返回这次挂载**钉住的版本 id**。
 *
 * #1559：版本 id 从 `POST /threads/:id/skill-mounts` 的响应体里取（契约
 * `mountSkillToThread.out.mounts[].versionId`），不在测试里按 `${skillId}-v1` 拼一个
 * 字面量——那样等于把种子脚本的命名约定抄成第二份事实，种子改个后缀这条断言就会
 * 假绿/假红。响应体里的那个值就是服务端真的写进 `thread_skill_mounts.version_id` 的东西。
 */
async function mountSkill(page: Page, threadId: string): Promise<string> {
  const mountResponse = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().includes(`/threads/${threadId}/skill-mounts`)
  ));
  // 「加 skill」在版本号读到之前是禁用的（拒绝盲写），所以这里等它可点而不是硬点。
  await expect(page.getByTestId("chat-skill-mount")).toBeEnabled();
  await page.getByTestId("chat-skill-mount").click();
  await expect(page.getByTestId("chat-skill-mount-picker")).toBeVisible();
  await page.getByTestId(`chat-skill-mount-option-${CHAT_READ_E2E.mountableSkillId}`).click();
  const settled = await mountResponse;
  expect(settled.ok()).toBe(true);
  await expect(page.getByTestId(`chat-skill-mounted-${CHAT_READ_E2E.mountableSkillId}`)).toBeVisible();

  const body = await settled.json() as {
    mounts: { skillId: string; versionId: string; removedAt: string | null }[];
  };
  const mounted = body.mounts.find(
    (m) => m.skillId === CHAT_READ_E2E.mountableSkillId && m.removedAt === null,
  );
  expect(mounted, "挂载响应里应有这个 skill 的生效挂载记录").toBeTruthy();
  return mounted!.versionId;
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
interface RunProjectionSlice {
  readonly status: string;
  readonly skillVersionIds: readonly string[];
  /** #1559：定位这次 run 写回的那条 assistant 消息，用来读它的正文（见测试②）。 */
  readonly resultMessageId: string | null;
}

async function pollRunToTerminal(
  page: Page,
  headers: Record<string, string>,
  runId: string,
): Promise<RunProjectionSlice> {
  let last: RunProjectionSlice | null = null;
  await expect.poll(async () => {
    const res = await page.request.get(`/agent-runs/${runId}`, { headers });
    expect(res.ok(), `GET /agent-runs/${runId} 应返回 2xx`).toBe(true);
    const projection = await res.json() as RunProjectionSlice;
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

/* ══════════════ ② 挂载 → 运行：因果链的**真反证**（#1559 修复后的方向） ══════════════ */

test("F65/#1559 → #2514：不挂任何 skill，已启用 skill 已在 run 快照里且正文到达模型；再挂同一个是幂等的", async ({ page }) => {
  /*
   * 2026-09-02 人类裁决（#2514）：skills 不由用户挑选——agent 直接加载全部已启用 skill。
   * 本条此前的「挂载前无哨兵 → 挂载后有哨兵」对照在新规则下**不可能成立**：夹具 agent
   * 没钉任何 skill ⇒ 走默认加载 ⇒ 第一条消息就已经带上可挂载 skill 的正文。于是对照
   * 改成两半：
   *   A. 不做任何挂载，run 快照里就有那个 skill 的当前版本，且哨兵回显（默认加载真的
   *      穿过了 acceptHumanMessage → readPinnedSkills → buildSystemPrompt → provider）。
   *   B. 旧轨道的挂载面板仍在：挂上同一个 skill 后，run 快照**不多不少**——追加 + 去重
   *      （契约 `SkillOrchestration` 注释：挂载是追加，默认加载已带上的 skill 再挂是幂等）。
   * 反证仍然存在：默认加载没接上 ⇒ A 的快照为空、哨兵不出现 ⇒ 本条如实红；去重坏了 ⇒
   * B 的快照里同一版本出现两次 ⇒ 红。
   */
  await login(page);
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.restructureProjectId}&thread=${CHAT_READ_E2E.causalCheckThreadId}`);
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.causalCheckThreadId}`))
    .toContainText("Causal check fixture thread");

  const headers = await authHeaders(page);

  function messageRow(messageId: string) {
    // ⚠ 必须同时锚 `chat-message-row`：`data-message-id` 在同一条消息里挂在三个元素上
    //   （消息行、复制按钮、评分块），只按它选会 strict mode violation（同测试③）。
    return page.locator(`[data-testid="chat-message-row"][data-message-id="${messageId}"]`);
  }

  /* ═══════════ A. 什么都不挂，直接发 ═══════════ */
  const beforeRunId = await sendMessage(page, CHAT_READ_E2E.causalCheckThreadId, "不挂 skill：第一条取证消息");
  const beforeRun = await pollRunToTerminal(page, headers, beforeRunId);
  expect(beforeRun.status, "默认加载下这次 run 应该正常跑到 succeeded").toBe("succeeded");
  expect(
    beforeRun.skillVersionIds.length,
    "#2514：夹具 agent 没钉 skill ⇒ 走默认加载 ⇒ 快照里至少有组织那个已启用的 skill",
  ).toBeGreaterThan(0);
  expect(beforeRun.resultMessageId, "这次 run 应该写回了一条回复").toBeTruthy();
  const beforeReply = messageRow(beforeRun.resultMessageId!);
  await expect(beforeReply).toBeVisible();
  await expect(beforeReply).toContainText(CHAT_READ_E2E.agentReplyPrefix);
  await expect(
    beforeReply,
    "#2514 核心验收：用户没挑任何 skill，已启用 skill 的正文也必须进入模型输入（上游在 system prompt 里看到哨兵才回显）",
  ).toContainText(`${CHAT_READ_E2E.mountedSkillEchoPrefix}${CHAT_READ_E2E.mountedSkillSentinel}`);

  /* ═══════════ B. 旧轨道挂载同一个 skill：幂等 ═══════════ */
  const mountedVersionId = await mountSkill(page, CHAT_READ_E2E.causalCheckThreadId);
  expect(
    beforeRun.skillVersionIds,
    "A 里默认加载的正是挂载面板挂的那个版本（`currentVersionId` 与默认加载读的是同一条「最新已发布」子查询）",
  ).toContain(mountedVersionId);

  const afterRunId = await sendMessage(page, CHAT_READ_E2E.causalCheckThreadId, "挂载后：第二条取证消息");
  const afterRun = await pollRunToTerminal(page, headers, afterRunId);
  expect(afterRun.status, "挂载后这次 run 也应该正常跑到 succeeded").toBe("succeeded");
  expect(
    afterRun.skillVersionIds,
    "挂载是追加 + 去重：默认加载已带上的 skill 再挂一次，快照逐字不变",
  ).toEqual(beforeRun.skillVersionIds);
  expect(
    afterRun.skillVersionIds.filter((id) => id === mountedVersionId),
    "同一份 SKILL.md 不该在 system prompt 里出现两遍",
  ).toHaveLength(1);
  expect(afterRun.resultMessageId).toBeTruthy();
  const afterReply = messageRow(afterRun.resultMessageId!);
  await expect(afterReply).toContainText(`${CHAT_READ_E2E.mountedSkillEchoPrefix}${CHAT_READ_E2E.mountedSkillSentinel}`);

  /* ── 落库复核：刷新一次，回复不是渲染在内存里的一帧 ── */
  await page.reload();
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.causalCheckThreadId}`))
    .toContainText("Causal check fixture thread");
  await expect(messageRow(beforeRun.resultMessageId!))
    .toContainText(CHAT_READ_E2E.mountedSkillSentinel);
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

  /*
   * context-engine 可用性补口：F155 的确定性回显只能证明"内容真的到达了模型输入"
   * （这件事回复渲染出来之前就已经发生），不能证明"用户自己能在界面上看到召回了
   * 什么"——`chat-live-message-panel.tsx` 此前压根没有任何来源展示面。这里断言
   * `GET /agent-runs/:runId/context-snapshot` 接的这枚徽标真的把 `chat-attachment`
   * 这个来源标记摆在了用户看得到的地方，不是只存在于确定性替身的回显文本里。
   */
  const groundedSnapshotToggle = groundedReply.getByTestId("context-snapshot-toggle");
  await expect(groundedSnapshotToggle).toBeVisible();
  await groundedSnapshotToggle.click();
  await expect(groundedReply.getByTestId("context-snapshot-l3-source-chat-attachment")).toBeVisible();

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
