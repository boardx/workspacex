/**
 * design-delta chat-persona-roundtrip（confirmed 2026-08-18）的核心验收线——
 * 「保存 → 关 → 整页 reload → 重开 → 看到保存版 + 提示条 → 回到原始版」真栈 e2e
 * （真浏览器 → apps/web → apps/api → PostgreSQL + 文件对象存储）。
 *
 * 归属 config：`playwright.chat-read.config.ts`（verification.md 原文点名
 * fullstack-smoke，改挂这里的理由与 #1310 相同——chat-read config 已经把这条链路
 * 需要的全部编排起好了：确定性 model provider + 已种好的 chat 线程 + facilitator
 * 账号（`artifact.land` 能力），fullstack-smoke 的 seeded 链没有任何 chat 线程种子，
 * 要在那边跑还得把整套 chat 夹具复制一份；单自建 runner 是硬瓶颈，不复制编排）。
 *
 * 覆盖 G2 路径（verification：「两条路径至少覆盖一条，覆盖 G2 路径者优先」）：
 * mermaid 消息由「生成用户画像」真实产生（assistant mindmap 围栏），不是种进去的。
 */
import { expect, test } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

test("G2 生成画像 → 最大化编辑保存 → reload 重开看到保存版提示条 → 回到原始版", async ({ page }) => {
  test.setTimeout(240_000);

  // ── 登录并进入夹具线程 ────────────────────────────────────────────────
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  await expect(page.getByTestId("chat-message-list")).toContainText("Controlled fixture message 01");

  // ── 种画像素材：persona 文本语法逐字进线程正文（发真实消息，不注入 DB）──
  const input = page.getByRole("textbox", { name: "消息内容" });
  await input.fill("姓名: 陈静\n## 目标和需求\n- 确保订单准时交付率稳定在95%以上");
  const accepted = page.waitForResponse((r) =>
    r.request().method() === "POST" && r.url().endsWith(`/chat/threads/${CHAT_READ_E2E.threadId}/messages`));
  await page.getByTestId("chat-message-submit").click();
  expect((await accepted).status()).toBe(202);

  // ── G2：触发「生成用户画像」，assistant mindmap 消息进入线程并渲染 ──────
  const personaResponse = page.waitForResponse((r) =>
    r.request().method() === "POST" && r.url().endsWith(`/chat/threads/${CHAT_READ_E2E.threadId}/persona-summary`));
  await page.getByTestId("chat-persona-summary-trigger").click();
  const personaOut = await (await personaResponse).json() as { resultMessageId: string; sufficient: boolean };
  expect(personaOut.sufficient).toBe(true);
  expect(typeof personaOut.resultMessageId).toBe("string");

  // 夹具线程有 51+ 条种子消息，首页只显示最老的 50 条——新消息在第二页（与
  // chat-read.spec 同一现实），先翻页再找图。
  await page.getByTestId("chat-messages-load-more").click();

  // mindmap 围栏走既有 fabric 通道渲染出来（mermaid.parse 真跑在浏览器里）。
  const diagram = page.locator('[data-testid="chat-diagram-fabric"][data-diagram-type="mindmap"]').last();
  await diagram.scrollIntoViewIfNeeded();
  await expect(diagram).toHaveAttribute("data-ready", "true", { timeout: 60_000 });

  // ── 最大化 → 编辑（＋节点 = 「新节点」文本）→ 保存 ─────────────────────
  await diagram.getByTestId("chat-diagram-maximize").click();
  const modal = page.getByTestId("chat-diagram-canvas-modal");
  await expect(modal).toBeVisible();
  // 首次打开：还没有保存版，不该出现读回提示条（回归既有行为）。
  await expect(page.getByTestId("chat-diagram-loaded-saved")).toHaveCount(0);
  await expect(page.getByTestId("canvas-fabric-surface")).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("chat-diagram-tool-node").click();
  const surface = page.getByTestId("canvas-fabric-surface");
  const box = (await surface.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.8);
  await expect(page.getByTestId("chat-diagram-dirty")).toBeVisible();

  const landResponse = page.waitForResponse((r) =>
    r.request().method() === "POST" && r.url().endsWith(`/chat/threads/${CHAT_READ_E2E.threadId}/artifacts`));
  await page.getByTestId("chat-diagram-save").click();
  expect((await landResponse).status()).toBe(200);
  await expect(page.getByTestId("chat-diagram-saved")).toBeVisible();
  const savedSource = await page.getByTestId("chat-diagram-saved-source").textContent();
  expect(savedSource).toContain("新节点");

  // ── 关闭 modal，**整页 reload**（穿透前端内存态）────────────────────────
  await page.getByTestId("chat-diagram-close").click();
  await page.reload();
  await expect(page.getByTestId("chat-message-list")).toContainText("Controlled fixture message 01");
  await page.getByTestId("chat-messages-load-more").click();

  // ── 重开同一消息的最大化 ⇒ 保存版初始化 + 读回提示条 ──────────────────
  const diagram2 = page.locator('[data-testid="chat-diagram-fabric"][data-diagram-type="mindmap"]').last();
  await diagram2.scrollIntoViewIfNeeded();
  await expect(diagram2).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  const sourceResponse = page.waitForResponse((r) =>
    r.request().method() === "GET" && /\/artifacts\/[^/]+\/source/.test(r.url()));
  await diagram2.getByTestId("chat-diagram-maximize").click();
  expect((await sourceResponse).status()).toBe(200);
  await expect(page.getByTestId("chat-diagram-canvas-modal")).toBeVisible();
  await expect(page.getByTestId("chat-diagram-loaded-saved")).toBeVisible();

  // modal 内容 = 保存版：再保存一次（不去重是签核语义），saved-source 回显的
  // mermaid 源必须仍含第 2 步加入的「新节点」——证明初始化内容来自对象存储的
  // 保存字节，不是消息原文。
  await expect(page.getByTestId("canvas-fabric-surface")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("chat-diagram-save").click();
  await expect(page.getByTestId("chat-diagram-saved")).toBeVisible();
  const reopenedSource = await page.getByTestId("chat-diagram-saved-source").textContent();
  expect(reopenedSource).toContain("新节点");

  // ── 回到原始版本：提示条切换，可再切回保存版（不静默替换）────────────
  await page.getByTestId("chat-diagram-revert-original").click();
  await expect(page.getByTestId("chat-diagram-viewing-original")).toBeVisible();
  await expect(page.getByTestId("chat-diagram-loaded-saved")).toHaveCount(0);
  // 原始版内容不含「新节点」：切回原始后再保存一次，saved-source 不得再出现它。
  await page.getByTestId("chat-diagram-save").click();
  await expect(page.getByTestId("chat-diagram-saved")).toBeVisible();
  const originalSource = await page.getByTestId("chat-diagram-saved-source").textContent();
  expect(originalSource).not.toContain("新节点");
  await page.getByTestId("chat-diagram-back-to-saved").click();
  await expect(page.getByTestId("chat-diagram-loaded-saved")).toBeVisible();
});
