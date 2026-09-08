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
import { awaitAssistantReply, bearerOf, listPersistedMessages, snapshotMessageIds, V2_SEND_WIRE } from "./chat-v2-send";
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
  /*
   * issue #2997 —— `#2890` 之后 `/chat?projectId=` 渲染的是 CopilotKit v2 工作台，
   * 旧屏已无可达路由。原实现依赖三样 v2 上不存在的东西（不是换 testid 能解决的）：
   *   ① `POST /chat/threads/:id/messages`（202 + `agentRunId`）—— v2 走
   *      `POST /api/copilotkit/agent/:id/run`，AG-UI 流里**没有 runId 字段**，
   *      浏览器拿不到它（实测取证见 `chat-v2-send.ts` 头注）；
   *   ② `chat-live-agent-run-status` 排队态 —— v2 没有权威 run 状态条
   *      （`lib/copilotkit-v2-run-progress.ts:43-49` 已自陈为 backlog）；
   *   ③ `getByRole("textbox", { name: "消息内容" })` —— v2 的 `<textarea>` 没有
   *      `aria-label`（真栈探针实测 `ariaLabel: null`），匹配不到。
   *
   * 本函数的契约（返回这一轮的 `AgentRun` id）保持不变，只是改成从**落库投影**
   * 拿：轮询 `GET /chat/threads/:id/messages`，等这一轮新落库的 assistant 消息，
   * 读它的 `agentRunId`。调用方随后对这个 id 做的事（读 run 快照 / 断言
   * `skillVersionIds`）逐字未动。
   *
   * ⚠ 代价如实记录：旧实现在**排队那一刻**就能拿到 runId，本实现要等写回落库。
   *   本文件两个调用方随后都要等终态，所以对它们没有影响；但如果将来有人想在
   *   run 还在跑的时候拿 id，这里给不了——那要等 v2 补上权威状态条（缺口 issue **#3023**）。
   */
  const bearer = await bearerOf(page);
  const knownIds = await snapshotMessageIds(page, threadId, bearer);

  const input = page.getByTestId("copilotkit-v2-input");
  await expect(input).toBeVisible({ timeout: 60_000 });
  await input.fill(text);
  const runRequest = page.waitForRequest(
    (r) => r.method() === "POST" && V2_SEND_WIRE.test(new URL(r.url()).pathname),
    { timeout: 60_000 },
  );
  await page.getByTestId("copilotkit-v2-send").click();
  expect(JSON.stringify((await runRequest).postDataJSON())).toContain(text);

  const reply = await awaitAssistantReply(page, threadId, bearer, knownIds, 90_000);
  expect(reply.agentRunId, "写回落库的 assistant 消息必须带着这一轮的 agentRunId").toBeTruthy();
  return reply.agentRunId!;
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
  /*
   * issue #2997 —— `toBeVisible()` → `toBeAttached()`。
   *
   * v2 用的是同一个 `ChatSkillMountPanel`，但走 `variant="composer"` 的 headless
   * 分支（触发器搬进了 composer 的「+」那一排）。该分支**没挂任何 skill 且浮层没开
   * 时是零尺寸容器**——这不是本次迁移发明的判据，是组件自己头注里就写着的：
   * 「没挂任何 skill 且浮层没开时零尺寸——e2e 判"面板已就位"用 `toBeAttached()`」
   * （`chat-skill-mount-panel.tsx:502-504`）。
   *
   * 本用例这一行要证的是「面板已就位」，不是「面板有像素」——真栈实测这行拿到的
   * 正是那个零尺寸容器（`data-mounted-count="0"`，`Received: hidden`），元素在、
   * 只是没内容。下面紧接着的 `chat-skill-mount-empty` 可见性断言才是"空态真的画出来
   * 了"那一半，没有动。
   */
  await expect(panel).toBeAttached();
  /*
   * 前提：现在一个都没挂。没有这条，下面「挂上了」的断言可能一开始就是真的。
   *
   * issue #2997 —— 锚点从「空态文案」换成「面板自陈的挂载数」。`chat-skill-mount-empty`
   * （"还没有挂载任何 skill"）只在**非** headless 那个 `<section>` 分支里渲染
   * （`chat-skill-mount-panel.tsx` 的 `return <section>` 一支）；v2 走的是 headless
   * 的 `variant="composer"` 分支，那一支只渲染已挂载 chip + 浮层，没有这句文案。
   *
   * 但**同一个容器把挂载数当属性挂了出来**（`data-mounted-count={mounts.length}`），
   * 两个分支都有。换成断言它等于 "0" —— 判据没有放宽，反而更精确：原来靠一句文案
   * 间接推断"零挂载"，现在直接读那个数。
   */
  await expect(panel).toHaveAttribute("data-mounted-count", "0");

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

/**
 * ⚠ issue #2997 / **#3028** —— 本用例在 v2 工作台上**跑不起来，不是断言写错了**。
 *
 * 它要证的事需要两件同时成立：① 在**种好历史的那条线程**里跑；② 这一轮走
 * `CHAT_READ_E2E.agentId`（loopback-echo）那个确定性上游——只有它会回显
 * `l2SummaryEchoPrefix` / `toolTraceEchoPrefix` / `retrievalEchoPrefix` 这些
 * 「某一层上下文真的到达了模型输入」的哨兵串。
 *
 * v2 上这两件事互斥（#3028）：深链进那条线程 ⇒ 用的是服务端默认 agent
 * （`COPILOTKIT_V2_AGENT_ID` → deep-agent，回显的是它自己的剧本）；切到
 * `agentId` ⇒ `copilotkit-v2-panel.tsx:274` 的 `key={selectedAgentId}` 会卸载
 * 当前对话、开一条全新的（新 threadId、空消息），种好的历史随之消失。
 *
 * 真栈实测（2026-09-08）：
 * ```
 * Expected substring: "[loopback]"
 * Received string:    "[skill:]MOUNTPROOF-9317 根据查询结果回答你：…"   ← deep-agent 的剧本
 * ```
 *
 * 按人类裁决（方案 B）：**不删断言、不改宽**。锚点已经迁完（下面的正文就是迁移后的
 * 版本，`chat-v2-send.ts` 那套取证也已接上），差的只是 #3028 那条产品能力；
 * #3028 一旦补上，把 `test.fixme` 改回 `test` 即可，正文不需要再动。
 */
test.fixme("F65/#1559 → #2514：不挂任何 skill，已启用 skill 已在 run 快照里且正文到达模型；再挂同一个是幂等的", async ({ page }) => {
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

  /*
   * issue #2997 —— v2 的消息由框架 slot 渲染，**没有 `chat-message-row[data-message-id]`
   * 这个行级锚点**（真栈探针实测计数为 0）。改成按落库正文在 `copilot-assistant-message`
   * 气泡里定位——`resolveReplyBubble` 先用 `listMessages` 把这条 id 的正文读回来，
   * 再拿正文去匹配气泡，仍然是"精确定位到这一条回复"，不是"随便找一条含某串的气泡"。
   */
  async function messageRow(messageId: string) {
    const bearer = await bearerOf(page);
    const messages = await listPersistedMessages(page, CHAT_READ_E2E.causalCheckThreadId, bearer);
    const target = messages.find((m) => m.id === messageId);
    expect(target, `落库消息里应能找到 ${messageId}`).toBeTruthy();
    return page.getByTestId("copilot-assistant-message").filter({ hasText: target!.text.slice(0, 40) }).last();
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
  const beforeReply = await messageRow(beforeRun.resultMessageId!);
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
  const afterReply = await messageRow(afterRun.resultMessageId!);
  await expect(afterReply).toContainText(`${CHAT_READ_E2E.mountedSkillEchoPrefix}${CHAT_READ_E2E.mountedSkillSentinel}`);

  /* ── 落库复核：刷新一次，回复不是渲染在内存里的一帧 ── */
  await page.reload();
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.causalCheckThreadId}`))
    .toContainText("Causal check fixture thread");
  await expect(await messageRow(beforeRun.resultMessageId!))
    .toContainText(CHAT_READ_E2E.mountedSkillSentinel);
});

/* ═══════════════════════════ ③ F155：context 命中/未命中对照 ═══════════════════════════ */

/**
 * ⚠ issue #2997 / **#3028** —— 本用例在 v2 工作台上**跑不起来，不是断言写错了**。
 *
 * 它要证的事需要两件同时成立：① 在**种好历史的那条线程**里跑；② 这一轮走
 * `CHAT_READ_E2E.agentId`（loopback-echo）那个确定性上游——只有它会回显
 * `l2SummaryEchoPrefix` / `toolTraceEchoPrefix` / `retrievalEchoPrefix` 这些
 * 「某一层上下文真的到达了模型输入」的哨兵串。
 *
 * v2 上这两件事互斥（#3028）：深链进那条线程 ⇒ 用的是服务端默认 agent
 * （`COPILOTKIT_V2_AGENT_ID` → deep-agent，回显的是它自己的剧本）；切到
 * `agentId` ⇒ `copilotkit-v2-panel.tsx:274` 的 `key={selectedAgentId}` 会卸载
 * 当前对话、开一条全新的（新 threadId、空消息），种好的历史随之消失。
 *
 * 真栈实测（2026-09-08）：
 * ```
 * Expected substring: "[loopback]"
 * Received string:    "[skill:]MOUNTPROOF-9317 根据查询结果回答你：…"   ← deep-agent 的剧本
 * ```
 *
 * 按人类裁决（方案 B）：**不删断言、不改宽**。锚点已经迁完（下面的正文就是迁移后的
 * 版本，`chat-v2-send.ts` 那套取证也已接上），差的只是 #3028 那条产品能力；
 * #3028 一旦补上，把 `test.fixme` 改回 `test` 即可，正文不需要再动。
 */
test.fixme("F155：命中项目内可检索文件的提问带来源标记，未命中的不带", async ({ page }) => {
  await login(page);
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.restructureProjectId}&thread=${CHAT_READ_E2E.contextCheckThreadId}`);
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.contextCheckThreadId}`))
    .toContainText("Context check fixture thread");

  const headers = await authHeaders(page);

  /*
   * issue #2997 —— 终态判据从旧屏的 `chat-live-agent-run-status`（`data-run-status` /
   * `data-result-message-id`，v2 上没有这条状态条）换成：
   *   ① `sendMessage` 拿到这一轮的 `agentRunId`（已改为从落库投影读，见该函数头注）；
   *   ② 直连 `GET /agent-runs/:id` 断言**恰好 succeeded**（原文那条"不是『不再是
   *      queued』"的纪律逐字保留，只是从 DOM 属性换成同一事实的 API 面）；
   *   ③ 从 run 快照里取 `resultMessageId`。
   * 这里降级的是"这件事对用户可见"这一层——那正是缺口 issue 记录的内容，不在这里
   * 假装它还成立。
   */
  async function sendAndAwaitRun(text: string): Promise<string> {
    const runId = await sendMessage(page, CHAT_READ_E2E.contextCheckThreadId, text);
    const run = await pollRunToTerminal(page, headers, runId);
    expect(run.status, "这次 run 应该恰好 succeeded（failed 也不再是 queued，不能放宽成后者）").toBe("succeeded");
    expect(run.resultMessageId, "写回提交后必须能拿到回复消息 id").toBeTruthy();
    return run.resultMessageId!;
  }

  // 这条线程是专属、零预置消息的夹具（见文件头），发出去的消息天然落在第一页，
  // 定位回复不需要任何翻页逻辑——这正是 #1324 重构要解决的失败定位问题。
  // issue #2997 —— 同测试②：v2 没有行级 `data-message-id` 锚点，按落库正文定位气泡。
  async function messageRow(messageId: string) {
    const bearer = await bearerOf(page);
    const messages = await listPersistedMessages(page, CHAT_READ_E2E.contextCheckThreadId, bearer);
    const target = messages.find((m) => m.id === messageId);
    expect(target, `落库消息里应能找到 ${messageId}`).toBeTruthy();
    return page.getByTestId("copilot-assistant-message").filter({ hasText: target!.text.slice(0, 40) }).last();
  }

  /* ═══════════ 反向对照先跑：不命中任何文件的提问 ═══════════
   *
   * 顺序是判据的一部分，必须排在命中那一轮之前：命中那轮的回复文本里会含有来源标记，
   * 而它随后就成了 L1 近端历史的一部分。先跑对照，就不存在「上一轮的回显污染这一轮」
   * 这种解释空间。（替身那侧还另有一道防线：只认以 L3 伪消息头开头的 assistant 消息，
   * 见 `loopback-model-provider.ts` 的 `retrievedSourceKinds`。两道各自独立。） */
  const decoyMessageId = await sendAndAwaitRun(CHAT_READ_E2E.retrievalDecoyQuery);
  const decoyReply = await messageRow(decoyMessageId);
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
  const groundedReply = await messageRow(groundedMessageId);
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
  // issue #2997 —— 这三行（上下文快照徽标里的 L3 来源标记）在 v2 上**没有对等实现**：
  // `message-context-snapshot.tsx` 的唯一消费者是旧屏 `chat-live-message-panel.tsx:1201`
  // （真栈探针实测 `context-snapshot-toggle` 计数为 0）。按人类裁决（方案 B）不删、
  // 不改宽，原文保留在本文件末尾的 `test.fixme` 里，产品缺口 issue：**#3023**。
  // 上面那条 `retrievalEchoPrefix` + `chat-attachment` 的断言仍然完整钉住
  // 「检索内容真的到达了模型输入」这一半；丢掉的是「用户自己在界面上看得见」那一半。

  /* ═══════════ 结果真的落在这条对话里 ═══════════
   *
   * 刷新一次再看：回复不是渲染在内存里的一帧，是写回了库、重读得回来的一条消息。 */
  await page.reload();
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.contextCheckThreadId}`))
    .toContainText("Context check fixture thread");
  const persistedReply = await messageRow(groundedMessageId);
  await expect(persistedReply).toBeVisible();
  // 来源标记也是重读回来的，不是上一帧留在内存里的。
  await expect(persistedReply).toContainText(CHAT_READ_E2E.retrievalEchoPrefix);
});

/**
 * issue #2997 —— **原文保留的断言：F155 的可用性补口（用户能在界面上看到召回来源）。**
 *
 * F155 那条用例的确定性回显只证明"内容真的到达了模型输入"；`context-snapshot-*`
 * 徽标是它的另一半——"用户自己看得见召回了什么"。v2 上这个徽标不存在，取证见
 * `apps/web/lib/copilotkit-v2-run-progress.ts:43-49` 的自陈与真栈探针实测。
 * 按人类裁决（方案 B）不删断言、不改宽，用 `test.fixme` 钉住等产品补齐。
 */
test.fixme("F155 可用性补口：召回来源在界面上可见（v2 尚无对等实现，issue #2997 缺口）", async ({ page }) => {
  await login(page);
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.restructureProjectId}&thread=${CHAT_READ_E2E.contextCheckThreadId}`);
  const headers = await authHeaders(page);
  const runId = await sendMessage(
    page, CHAT_READ_E2E.contextCheckThreadId,
    `${CHAT_READ_E2E.retrievalTerm} 的回滚窗口是多久？`,
  );
  const run = await pollRunToTerminal(page, headers, runId);
  const bearer = await bearerOf(page);
  const messages = await listPersistedMessages(page, CHAT_READ_E2E.contextCheckThreadId, bearer);
  const target = messages.find((m) => m.id === run.resultMessageId)!;
  const groundedReply = page.getByTestId("copilot-assistant-message").filter({ hasText: target.text.slice(0, 40) }).last();

  const groundedSnapshotToggle = groundedReply.getByTestId("context-snapshot-toggle");
  await expect(groundedSnapshotToggle).toBeVisible();
  await groundedSnapshotToggle.click();
  await expect(groundedReply.getByTestId("context-snapshot-l3-source-chat-attachment")).toBeVisible();
});
