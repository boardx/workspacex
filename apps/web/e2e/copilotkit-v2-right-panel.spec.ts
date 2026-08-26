import { test, expect, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { SESSION_TOKEN_STORAGE_KEY } from "../lib/api-client";

/**
 * issue #2046（CK-P1 + CK-P2，人类 2026-08-25 点名）—— `/chat`（#2044 路由原生化后）右栏
 * 「材料 + 产物」与 composer `@` 文件引用的真实浏览器取证。
 *
 * ## 取证链路
 *
 * - 材料：上传一个真实附件（真实 multipart → `chat_message_attachments`）、随消息
 *   发出（`forwardedProps.attachmentIds` → `acceptHumanMessage` 原子挂接）后，右栏
 *   「材料」列表必须出现该文件——数据来自 `listThreadAttachments`（只列已随消息
 *   发出的附件），刷新由面板 `onMessageSent`（run settle 后）触发。链上任何一环断
 *   （上传线程与消息线程不是同一条——正是本 issue 连带修的 #2032×#2028 合成 bug、
 *   attachmentIds 没透传、settle 后没刷新）文件都不会出现，断言如实红。
 * - `@` 引用：材料就位后在输入框敲 `@` + 文件名片段，候选下拉必须弹出该文件并在
 *   点击后把 `@文件名 ` 插进正文（候选与「材料」是同一份数据，见 shell 注释）。
 * - 产物：`landAsArtifact` 是旧轨道的能力（v2 的落地入口是 #2046 明确另开任务的
 *   TODO，见 issue 设计说明），这里直连 API 落一份草稿产物（个人线程创建者
 *   `artifact.land` 能力 2026-08-21 人类裁决放行，draft 模式），刷新页面后右栏
 *   「产物」列表必须读到它——证明产物栏接的是真实 `listThreadArtifacts` 读路径，
 *   不是空壳。
 */

test.setTimeout(180_000);

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);
}

/** 同 `copilotkit-v2-attachments.spec.ts`：先把 CopilotRuntime 路由焐热。 */
async function warmUpCopilotRuntimeRoute(page: Page): Promise<void> {
  await expect
    .poll(
      async () => (await page.request.get("/api/copilotkit/info")).status(),
      { timeout: 60_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(200);
}

/**
 * `/chat/[threadId]` 动态路由的编译焐热——逐字同 `copilotkit-v2-skill-mount.spec.ts`
 * 的 `warmUpThreadRoute`（该文件头注记录了实测根因：本套件里以客户端导航首次进入
 * 这个动态段时，Next dev 按需编译期间导航不提交，`waitForURL` 被编译时间挤爆）。
 * 本 spec 第 4 轮实测踩到同一个坑（`chat-thread-create` 点击后 60s 不落地，错误
 * 上下文快照显示线程其实已经建出来了），因此照抄这条既有对策，不是新发明。
 */
async function warmUpThreadRoute(page: Page): Promise<void> {
  await page.goto("/chat/warmup-route-compile-only");
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible({ timeout: 120_000 });
}

/** 直连 API 的鉴权头（同 `blueprint-contract-gap-audit.spec.ts` 的既有规矩）。 */
async function authHeaders(page: Page): Promise<Record<string, string>> {
  const token = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_TOKEN_STORAGE_KEY);
  expect(token, "登录之后 localStorage 里应有 session token").toBeTruthy();
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

/**
 * 本 spec 跑在 `playwright.chat-read.config.ts` 下（`CHAT_READ_E2E_API_ORIGIN`
 * 同源代理，`prefix = ""`，见 `next.config.mjs` rewrites）——直连 API 用裸路径，
 * 不是 fullstack 配置的 `/__fullstack_api` 前缀。
 */
const API = "";

const FILE_NAME = "right-panel-material-fixture.txt";
const FILE_CONTENT = "issue #2046 右栏材料取证附件。";
const ARTIFACT_TITLE = `右栏产物取证-${Date.now().toString(36)}`;

test("issue #2046：上传附件随消息发出后右栏「材料」出现；@ 弹出候选并插入引用；落地产物后右栏「产物」读到", async ({ page }) => {
  await warmUpCopilotRuntimeRoute(page);
  await login(page);
  await warmUpThreadRoute(page);
  await page.goto("/chat");

  /* ═══════════ ① 建一条持久化线程，右栏从首帧就在（空态如实） ═══════════ */
  await page.getByTestId("chat-thread-create").click();
  await page.waitForURL(/\/chat\/(?!warmup-)[^/]+$/, { timeout: 60_000 });
  const threadId = /\/chat\/([^/?#]+)/.exec(page.url())?.[1];
  expect(threadId).toBeTruthy();

  /* issue #2068（TW-P0-4）—— 右栏从「产物 + 材料」固定两段堆叠换成了四页签
     Inspector（`chat-task-inspector.tsx`），空态默认折叠成 40px 图标栏。本 spec 的
     每一条**实质**断言（上传落在本线程 / 材料栏读到文件 / 产物栏读到落地产物 /
     `@` 引用同一份材料数据）一条未删、一条未放宽——变的只是"先点到那个页签"。
     ⚠ 这是跟着一次**有意的重设计**走，不是把用例改松去迁就实现：旧锚点
     `copilotkit-v2-right-panel` 已经不存在，留着它只会红成"元素找不到"，
     掩盖掉后面那些真正在验证读写链路的断言。 */
  const inspector = page.getByTestId("chat-task-workbench-inspector");
  await expect(inspector).toBeVisible();
  await page.getByTestId("chat-task-workbench-inspector-tab-artifacts").click();
  await expect(page.getByTestId("chat-artifacts-empty")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("chat-task-workbench-inspector-tab-materials").click();
  await expect(page.getByTestId("chat-materials-empty")).toBeVisible();

  /* ═══════════ ② 上传附件 → 随消息发出 → 材料列表出现该文件 ═══════════ */
  const attachButton = page.getByTestId("chat-attachment-input");
  // issue #2046 连带修复的直接断言面：`[threadId]` 页上不再另建附件线程，上传
  // 直接落本线程——按钮从首帧就可用（不再等待第二条线程异步创建）。
  await expect.poll(async () => attachButton.isDisabled(), { timeout: 20_000 }).toBe(false);
  await attachButton.click();
  await expect(page.getByTestId("chat-attach-material-portal")).toBeVisible();

  const uploadResponsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && /\/chat\/threads\/[^/]+\/attachments$/.test(new URL(response.url()).pathname)
  ));
  await page.getByTestId("chat-attachment-file-input").setInputFiles({
    name: FILE_NAME,
    mimeType: "text/plain",
    buffer: Buffer.from(FILE_CONTENT, "utf8"),
  });
  const uploadResponse = await uploadResponsePromise;
  expect(uploadResponse.status()).toBe(201);
  // 上传必须落在 URL 里这条线程上（#2032×#2028 合成 bug 的回归锚点）。
  expect(new URL(uploadResponse.url()).pathname).toContain(`/chat/threads/${threadId}/attachments`);

  await page.getByTestId("chat-attach-material-confirm").click();
  await expect(page.getByTestId("chat-attach-material-portal")).toHaveCount(0);

  await page.getByTestId("copilotkit-v2-input").fill("请看这份材料");
  await page.getByTestId("copilotkit-v2-send").click();
  // run settle → onMessageSent → 右栏刷新：材料列表出现该文件（不刷新页面）。
  // 发消息会让 Inspector 自动切到「进度」（TW-P0-4②），这里显式点回「材料」。
  await page.getByTestId("chat-task-workbench-inspector-tab-materials").click();
  await expect(page.getByTestId("chat-materials-panel")).toContainText(FILE_NAME, { timeout: 60_000 });

  /* ═══════════ ③ `@` 引用：候选来自同一份材料数据，点击即插入 ═══════════ */
  const input = page.getByTestId("copilotkit-v2-input");
  await input.click();
  await input.pressSequentially("@right-panel");
  await expect(page.getByTestId("chat-attachment-mention-picker")).toBeVisible();
  await page.locator('[data-testid^="chat-attachment-mention-option-"]').first().click();
  await expect(input).toHaveValue(`@${FILE_NAME} `);
  await expect(page.getByTestId("chat-attachment-mention-picker")).toHaveCount(0);
  await input.fill("");

  /* ═══════════ ④ 产物：直连 API 落一份草稿，右栏「产物」读到 ═══════════ */
  const headers = await authHeaders(page);
  const messagesResponse = await page.request.get(
    `${API}/chat/threads/${threadId}/messages?limit=10`,
    { headers },
  );
  expect(messagesResponse.ok()).toBe(true);
  const { messages } = await messagesResponse.json() as { messages: Array<{ id: string }> };
  expect(messages.length).toBeGreaterThan(0);

  const landResponse = await page.request.post(
    `${API}/chat/threads/${threadId}/artifacts`,
    {
      headers,
      data: {
        threadId,
        messageId: messages[0]!.id,
        mode: "draft",
        title: ARTIFACT_TITLE,
        payloadRef: "issue #2046 右栏产物取证正文。",
      },
    },
  );
  expect(landResponse.ok(), `landAsArtifact 应成功：${landResponse.status()}`).toBe(true);

  // 落地发生在面板刷新时机之外（直连 API），刷新页面走 shell 的首载读取——
  // 断言的是「产物栏接的是真实 listThreadArtifacts 读路径」。
  await page.reload();
  await page.getByTestId("chat-task-workbench-inspector-tab-artifacts").click();
  await expect(page.getByTestId("chat-artifacts-panel")).toContainText(ARTIFACT_TITLE, { timeout: 30_000 });
});
