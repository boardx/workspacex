import { test, expect, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { SESSION_TOKEN_STORAGE_KEY } from "../lib/api-client";

/**
 * issue #2052（CK-P7 多 agent 编制 + 「落地为产物」入口）的真实浏览器取证。
 *
 * ⚠ 「流式消息 id ≠ 落库 id」这条缺口本身与它的修法（`CUSTOM chat_message_id` 回显）
 *   由 **CK-P3 / PR #2064** 落地并关闭 #2050，不是本 PR 的产出。本 spec 仍然断言它，
 *   理由是「落地为产物」直接依赖它——它一旦回归，本功能就变成点了必 404 的假按钮，
 *   而那种回归在只测编制的 spec 里是看不见的。
 *
 * ## ① 落地按钮必须挂在真实落库 id 上（依赖 #2064 的回显事件）
 *
 * 直接抓 `POST /copilotkit/agui` 那条 SSE 流的原文，把两个 id 都从 wire 上取出来比对：
 *
 *   - `TEXT_MESSAGE_START.messageId` —— 客户端气泡用的 id；
 *   - `CUSTOM {name:"chat_message_id"}.value.chatMessageId` —— #2064 落地的映射事件，
 *     值取自 `agui-bridge.ts` 的 `outcome.messageId`（`listMessagePage` 读回的主键）。
 *
 * ⚠ 这条 SSE **必须直连 API 取**，不能用 `page.waitForResponse` 从浏览器侧抓：v2 的
 *   浏览器打的是 Next 的 `/api/copilotkit/*`（CopilotRuntime），真正的
 *   `POST /copilotkit/agui` 是 runtime 在**服务端**发起的（`route.ts` 里构造
 *   `HttpAgent`，见 `copilotkit-v2-panel.tsx` 文件头），浏览器根本看不见它。
 *   第一版就是这么写错的——`waitForResponse` 会一直等到超时，而那种红看起来像
 *   "映射事件没发出来"，其实是取证手法本身站错了位置。
 *
 * 断言三件事：两者**确实不同**（这就是「不能照 wire id 画按钮」的活体证据，不是
 * 注释里的说法）；`chatMessageId` **确实**出现在 `GET /chat/threads/:id/messages`
 * 的返回里（证明它是真主键）；页面上那枚落地按钮的 testid 后缀用的是**后者**。
 *
 * ⚠ 反证价值：如果哪天有人把映射事件删掉，或改回用 wire id 渲染按钮，这条 spec 会红
 *   在「按钮 testid 用的是真实 id」那一步，而不是等用户点出一个 404。
 *
 * ## ② #2052 的编制取证锚点**不是**线程卡上的「N 个 agent」
 *
 * 派工时曾把线程列表项的「N 个 agent」当作端到端锚点。读代码后确认那是错的：
 * `thread-badges.ts:113` 的 `agentCount` 是 `new Set(speakingAgentIds).size`，
 * `ports.ts:147` 对该字段的定义逐字是「在本线程**发过言**的不同 agent id」——它统计
 * 发言者，不是编制。把一个 agent 加进编制、它还没说过话时那个数**本就不该变**，
 * 拿它当锚点会写出一条永远失败、或者为了变绿去污染语义的坏测试。
 *
 * 真锚点用编制自己的权威计数（`getAgentPanel` 的 `rosterCount`，栏头「本线程的
 * AI 团队 · N」渲染的就是它）+ **刷新后仍在**（证明真落库，不是本地 state）。
 *
 * ## 2026-08-29 更新：编制面板搬进右栏「编制」页签
 *
 * Claude Design 重设计稿把左栏这张常驻编制卡拿掉（人类原话「去掉本线程的AI团队
 * 当前编制为空,从agent市场加入 这一块」），就地问过之后人类选择「移到右栏
 * Inspector 里」，不是彻底去掉入口——`chat-read-roster` 这个组件与它全部
 * `data-testid` 逐字未变，只是现在挂在 `chat-task-workbench-inspector` 的
 * `roster` 页签下，默认折叠/未选中时不可见，需要先点开页签
 * （`chat-task-workbench-inspector-tab-roster`）。下面每处用到
 * `chat-read-roster` 之前都补了这一步。
 */

test.setTimeout(240_000);

const API = "";

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);
}

/** 同本目录既有 v2 spec：先把 CopilotRuntime 路由与 `[threadId]` 动态段焐热。 */
async function warmUp(page: Page): Promise<void> {
  await expect
    .poll(
      async () => (await page.request.get("/api/copilotkit/info")).status(),
      { timeout: 60_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(200);
}

async function warmUpThreadRoute(page: Page): Promise<void> {
  await page.goto("/chat/warmup-route-compile-only");
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible({ timeout: 120_000 });
}

async function authHeaders(page: Page): Promise<Record<string, string>> {
  const token = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_TOKEN_STORAGE_KEY);
  expect(token, "登录之后 localStorage 里应有 session token").toBeTruthy();
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

/** 从 SSE 原文里逐行取出 `data:` 负载。协议是 `data: <json>\n\n`（见控制器 `write`）。 */
function parseSseEvents(body: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      events.push(JSON.parse(line.slice("data: ".length)) as Record<string, unknown>);
    } catch {
      // 非 JSON 的 keep-alive 之类，忽略——不让解析失败伪装成"没有这个事件"。
    }
  }
  return events;
}

test("issue #2052：落地按钮挂真实落库 id 且产物真出现（依赖 #2064 回显）；编制加/移真落库", async ({ page }) => {
  await warmUp(page);
  await login(page);
  await warmUpThreadRoute(page);
  await page.goto("/chat");

  /* ═══════════ ① 建一条持久化线程 ═══════════ */
  await page.getByTestId("chat-thread-create").click();
  await page.waitForURL(/\/chat\/(?!warmup-)[^/]+$/, { timeout: 60_000 });
  const threadId = /\/chat\/([^/?#]+)/.exec(page.url())?.[1];
  expect(threadId).toBeTruthy();

  /* ═══════════ ② #2052 编制：加入一个「只在目录里、不在编制里」的 agent ═══════════
     用 `catalogOnlyAgentId` 而不是随便一个 agent：它一开始就不在编制里，所以一个
     什么都没做的实现不会碰巧变绿（这条理由是 fixture 自己写下的，照用）。 */
  // 2026-08-29——编制页签默认折叠/不选中，先点开才看得到面板（见文件头注更新）。
  await page.getByTestId("chat-task-workbench-inspector-tab-roster").click();
  const rosterPanel = page.getByTestId("chat-read-roster");
  await expect(rosterPanel).toBeVisible({ timeout: 30_000 });
  // 新建的个人线程编制为空——如实空态，不是"读不出来所以不画"。
  await expect(page.getByTestId("chat-roster-empty")).toBeVisible({ timeout: 30_000 });
  await expect(rosterPanel).toContainText("本线程的 AI 团队 · 0");

  await page.getByTestId("chat-roster-edit").click();
  const addSelect = page.getByTestId("chat-roster-add-input");
  await expect(addSelect).toBeEnabled({ timeout: 30_000 });
  await addSelect.selectOption(CHAT_READ_E2E.catalogOnlyAgentId);
  await page.getByTestId("chat-roster-add-submit").click();

  // 服务端返回后重读服务端（不是乐观更新）——编制里出现这个 agent，计数跟着变。
  await expect(page.getByTestId(`chat-roster-agent-${CHAT_READ_E2E.catalogOnlyAgentId}`))
    .toBeVisible({ timeout: 30_000 });
  await expect(rosterPanel).toContainText("本线程的 AI 团队 · 1");

  // ⭐ 真落库的判据：整页刷新后仍在。只改本地 state 的实现会在这一步红。
  // ⚠ 刷新后 Inspector 的 `activeTab` 回到默认值「进度」（组件重挂载，不是
  //   状态回滚成假的）——编制非空会让面板自动展开（`hasRoster` 撑开折叠态），
  //   但显示的仍是「进度」页签，需要重新点一次「编制」才能看到面板内容。
  await page.reload();
  await page.getByTestId("chat-task-workbench-inspector-tab-roster").click();
  await expect(page.getByTestId(`chat-roster-agent-${CHAT_READ_E2E.catalogOnlyAgentId}`))
    .toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("chat-read-roster")).toContainText("本线程的 AI 团队 · 1");

  // 服务端也要认这件事（不只是界面上有一行）。
  const headers = await authHeaders(page);
  const panelResponse = await page.request.get(`${API}/chat/threads/${threadId}/agents`, { headers });
  expect(panelResponse.ok(), `个人线程读编制应成功：${panelResponse.status()}`).toBe(true);
  const panel = await panelResponse.json() as { rosterCount: number; agents: Array<{ id: string }> };
  expect(panel.rosterCount).toBe(1);
  expect(panel.agents.map((a) => a.id)).toContain(CHAT_READ_E2E.catalogOnlyAgentId);

  /* ═══════════ ③ wire 取证：直连 AG-UI 端点，把两个 id 都取出来 ═══════════
     用真实的 `forwardedProps.chatThreadId` 续接上面这条线程，走的就是浏览器那条
     CopilotRuntime 背后完全相同的控制器代码路径。 */
  const aguiResponse = await page.request.post(`${API}/copilotkit/agui`, {
    headers,
    data: {
      threadId: `e2e-client-${Date.now().toString(36)}`,
      runId: `e2e-run-${Date.now().toString(36)}`,
      messages: [{ role: "user", content: "请回答一句话，用于产物落地取证。" }],
      forwardedProps: { chatThreadId: threadId },
    },
    timeout: 120_000,
  });
  expect(aguiResponse.ok(), `AG-UI 端点应成功：${aguiResponse.status()}`).toBe(true);
  const events = parseSseEvents(await aguiResponse.text());

  const textStart = events.find((e) => e.type === "TEXT_MESSAGE_START");
  expect(textStart, "wire 上应有 TEXT_MESSAGE_START").toBeTruthy();
  const streamingMessageId = textStart!.messageId as string;

  // ⚠ 事件名与字段形状取自契约 `@repo/contracts/agui-state-events`
  //   （`AGUI_CHAT_MESSAGE_ID_EVENT_NAME` / `AguiChatMessageIdValue`，CK-P3 #2064 落地），
  //   **不是**本 spec 自己起的名字：字段是 `streamingMessageId`（不是 wire/…），
  //   照抄一个近似名会让断言在字段缺失时静默拿到 undefined。
  const mapping = events.find((e) => e.type === "CUSTOM" && e.name === "chat_message_id");
  expect(mapping, "run 成功后应发 chat_message_id 映射事件（CK-P3 #2064 落地）").toBeTruthy();
  const mappingValue = mapping!.value as { streamingMessageId: string; chatMessageId: string };
  const chatMessageId = mappingValue.chatMessageId;
  expect(chatMessageId, "映射事件必须带非空 chatMessageId").toBeTruthy();

  // ⭐ 取证核心：两个 id **确实不同**。若哪天它们相等（比如控制器改回用真主键当
  //    流式 id），这条断言会红——那时该重新评估映射事件还有没有必要，而不是让一个
  //    已经不成立的前提继续躺在注释里。
  expect(chatMessageId, "映射事件里的真实 id 不应等于流式聚合 id")
    .not.toBe(streamingMessageId);
  expect(mappingValue.streamingMessageId).toBe(streamingMessageId);

  // ⭐ 且 `chatMessageId` 确实是落库主键：它必须出现在 messages 读端口的返回里。
  const messagesResponse = await page.request.get(
    `${API}/chat/threads/${threadId}/messages?limit=50`, { headers },
  );
  expect(messagesResponse.ok()).toBe(true);
  const { messages } = await messagesResponse.json() as { messages: Array<{ id: string }> };
  expect(messages.map((m) => m.id), "映射事件给的应是真实 chat_messages.id")
    .toContain(chatMessageId);
  expect(messages.map((m) => m.id), "流式聚合 id 按定义不该在库里")
    .not.toContain(streamingMessageId);

  /* ═══════════ ④ 浏览器侧：真正走一轮 UI 对话，映射事件必须驱动出落地按钮 ═══════════
     ③ 证的是 wire 上两个 id 不同；这一步证的是**前端确实用了映射给的那个真实 id**。
     刻意在 UI 里新发一轮（而不是刷新页面看 ③ 那条历史消息）：刷新走的是 hydration
     路径，那条路本来就拿真实 id，证明不了映射事件有没有生效。这一轮是全新流式消息，
     它的落地按钮**只可能**来自 `CUSTOM chat_message_id`。 */
  const beforeIds = new Set(messages.map((m) => m.id));

  await page.getByTestId("copilotkit-v2-input").fill("再回答一句，用于浏览器侧落地取证。");
  await page.getByTestId("copilotkit-v2-send").click();

  // run settle 后从服务端取"这一轮新产生的 assistant 消息"的真实 id。
  let streamedMessageId = "";
  await expect.poll(async () => {
    const r = await page.request.get(`${API}/chat/threads/${threadId}/messages?limit=50`, { headers });
    if (!r.ok()) return "";
    const body = await r.json() as { messages: Array<{ id: string; authorKind: string }> };
    const fresh = body.messages.filter((m) => !beforeIds.has(m.id) && m.authorKind !== "human");
    streamedMessageId = fresh[fresh.length - 1]?.id ?? "";
    return streamedMessageId;
  }, { timeout: 120_000, intervals: [1_000, 2_000, 3_000] }).not.toBe("");

  const landOpen = page.getByTestId(`chat-land-artifact-open-${streamedMessageId}`);
  await expect(landOpen, "流式消息的落地入口应挂在真实 chat_messages.id 上（映射事件生效）")
    .toBeVisible({ timeout: 60_000 });
  // 反证：用流式聚合 id 的那个按钮不存在（"点了才 404 的假按钮"没被画出来）。
  await expect(page.getByTestId(`chat-land-artifact-open-${streamingMessageId}`)).toHaveCount(0);
  const chatMessageIdForLanding = streamedMessageId;

  const artifactTitle = `v2-落地取证-${Date.now().toString(36)}`;
  await landOpen.click();
  await page.getByTestId(`chat-land-artifact-title-${chatMessageIdForLanding}`).fill(artifactTitle);
  await page.getByTestId(`chat-land-artifact-submit-${chatMessageIdForLanding}`).click();

  // 成功态卡片 + 右栏「产物」真的多出这一条（`onArtifactLanded` → 重读 listThreadArtifacts）。
  await expect(page.getByTestId(`chat-land-artifact-done-${chatMessageIdForLanding}`))
    .toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("chat-artifacts-panel"))
    .toContainText(artifactTitle, { timeout: 60_000 });

  /* ═══════════ ⑤ #2052 移出：反向也真的改数据 ═══════════
     ④ 落地产物触发了 Inspector 的自动切换规则（产物变多 → 切「产物」页签，
     见 `lib/chat-task-inspector-tabs.ts` 的 `nextInspectorTab`），此刻显示的
     不是「编制」页签，重新点回去才能看到「移出」按钮。 */
  await page.getByTestId("chat-task-workbench-inspector-tab-roster").click();
  await page.getByTestId(`chat-roster-remove-${CHAT_READ_E2E.catalogOnlyAgentId}`).click();
  await expect(page.getByTestId(`chat-roster-agent-${CHAT_READ_E2E.catalogOnlyAgentId}`))
    .toHaveCount(0, { timeout: 30_000 });

  const afterRemove = await page.request.get(`${API}/chat/threads/${threadId}/agents`, { headers });
  expect(afterRemove.ok()).toBe(true);
  expect((await afterRemove.json() as { rosterCount: number }).rosterCount).toBe(0);
});
