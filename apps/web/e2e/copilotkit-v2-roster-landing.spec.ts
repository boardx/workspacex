import { test, expect, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { SESSION_TOKEN_STORAGE_KEY } from "../lib/api-client";

/**
 * issue #2052（CK-P7 多 agent 编制）+ issue #2050（「落地为产物」入口）的真实浏览器取证。
 *
 * ## ① #2050 的取证是这个 spec 存在的首要理由
 *
 * issue 正文要求：**先证明**流式 assistant 消息 id 与落库 `chat_messages.id` 是不是
 * 同一个值，再决定接不接落地按钮。这里不靠读代码下结论——直接抓 `POST /copilotkit/agui`
 * 那条 SSE 流的原文，把两个 id 都从 wire 上取出来比对：
 *
 *   - `TEXT_MESSAGE_START.messageId` —— 客户端气泡用的 id；
 *   - `CUSTOM {name:"chat_message_id"}.value.chatMessageId` —— 本次新增的映射事件，
 *     值取自 `agui-bridge.ts` 的 `outcome.messageId`（`listMessagePage` 读回的主键）。
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

test("issue #2050 + #2052：流式消息 id ≠ 落库 id（映射事件补齐）→ 落地按钮用真实 id 且产物真出现；编制加/移真落库", async ({ page }) => {
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
  await page.reload();
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

  /* ═══════════ ③ #2050：发一轮对话，从 wire 上取两个 id 比对 ═══════════ */
  const aguiResponsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith("/copilotkit/agui")
  ), { timeout: 120_000 });

  await page.getByTestId("copilotkit-v2-input").fill("请回答一句话，用于产物落地取证。");
  await page.getByTestId("copilotkit-v2-send").click();

  const aguiResponse = await aguiResponsePromise;
  const events = parseSseEvents(await aguiResponse.text());

  const textStart = events.find((e) => e.type === "TEXT_MESSAGE_START");
  expect(textStart, "wire 上应有 TEXT_MESSAGE_START").toBeTruthy();
  const wireMessageId = textStart!.messageId as string;

  const mapping = events.find((e) => e.type === "CUSTOM" && e.name === "chat_message_id");
  expect(mapping, "run 成功后应补发 chat_message_id 映射事件（issue #2050 的修法）").toBeTruthy();
  const mappingValue = mapping!.value as { wireMessageId: string; chatMessageId: string };
  const chatMessageId = mappingValue.chatMessageId;

  // ⭐ 取证核心：两个 id **确实不同**。若哪天它们相等（比如控制器改回用真主键当
  //    wire id），这条断言会红——那时该重新评估映射事件还有没有必要，而不是让一个
  //    已经不成立的前提继续躺在注释里。
  expect(chatMessageId, "映射事件里的真实 id 不应等于 wire id（#2050 取证结论）")
    .not.toBe(wireMessageId);
  expect(mappingValue.wireMessageId).toBe(wireMessageId);

  // ⭐ 且 `chatMessageId` 确实是落库主键：它必须出现在 messages 读端口的返回里。
  const messagesResponse = await page.request.get(
    `${API}/chat/threads/${threadId}/messages?limit=50`, { headers },
  );
  expect(messagesResponse.ok()).toBe(true);
  const { messages } = await messagesResponse.json() as { messages: Array<{ id: string }> };
  expect(messages.map((m) => m.id), "映射事件给的应是真实 chat_messages.id")
    .toContain(chatMessageId);
  expect(messages.map((m) => m.id), "wire id 按定义不该在库里")
    .not.toContain(wireMessageId);

  /* ═══════════ ④ 落地按钮必须用真实 id，且点下去产物真的出现在右栏 ═══════════ */
  const landOpen = page.getByTestId(`chat-land-artifact-open-${chatMessageId}`);
  await expect(landOpen, "落地入口的 testid 后缀应是真实 chat_messages.id，不是 wire id")
    .toBeVisible({ timeout: 60_000 });
  // 反证：用 wire id 的那个按钮不存在（"点了才 404 的假按钮"没被画出来）。
  await expect(page.getByTestId(`chat-land-artifact-open-${wireMessageId}`)).toHaveCount(0);

  const artifactTitle = `v2-落地取证-${Date.now().toString(36)}`;
  await landOpen.click();
  await page.getByTestId(`chat-land-artifact-title-${chatMessageId}`).fill(artifactTitle);
  await page.getByTestId(`chat-land-artifact-submit-${chatMessageId}`).click();

  // 成功态卡片 + 右栏「产物」真的多出这一条（`onArtifactLanded` → 重读 listThreadArtifacts）。
  await expect(page.getByTestId(`chat-land-artifact-done-${chatMessageId}`))
    .toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("chat-artifacts-panel"))
    .toContainText(artifactTitle, { timeout: 60_000 });

  /* ═══════════ ⑤ #2052 移出：反向也真的改数据 ═══════════ */
  await page.getByTestId(`chat-roster-remove-${CHAT_READ_E2E.catalogOnlyAgentId}`).click();
  await expect(page.getByTestId(`chat-roster-agent-${CHAT_READ_E2E.catalogOnlyAgentId}`))
    .toHaveCount(0, { timeout: 30_000 });

  const afterRemove = await page.request.get(`${API}/chat/threads/${threadId}/agents`, { headers });
  expect(afterRemove.ok()).toBe(true);
  expect((await afterRemove.json() as { rosterCount: number }).rosterCount).toBe(0);
});
