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
import { expect, test, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * 反复点「加载更早之后的消息」直到按钮消失（真的翻到底，不是「翻出了某张目标图
 * 就提前停」——本文件跨用例共用同一条夹具线程、消息数会累加，「某个 mindmap 图
 * 出现了」不能保证是**这一条用例自己刚生成的那条**，只有翻到底才能确定最新消息
 * 已经加载）。面板此刻仍在软刷新消息流（context-engine 的 L1/L2/L3 徽标逐条轮询、
 * `MessageContextSnapshot` 挂载即拉取），点在刷新中点会短暂 `element was detached
 * from the DOM`——Playwright 单次 `.click()` 内建重试处理的是「元素还没就绪」，
 * 处理不了「持续被替换」这种反复剧烈重渲染，这里换成自己的重试外壳：每轮重新
 * 定位再点，吃掉瞬时 detach。
 */
async function loadAllMessagePages(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const button = page.getByTestId("chat-messages-load-more");
    if ((await button.count()) === 0) return;
    try {
      await button.click({ timeout: 10_000 });
    } catch {
      // 瞬时 detach：吃掉，下一轮重新定位再试。
    }
    await page.waitForTimeout(500);
  }
}

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

  // 等这条消息触发的 AgentRun 到终态再往下走：run 落定时面板会软刷新消息流并把
  // 分页重置回第一页——不等它，后面定位到的图会在刷新那一刻从 DOM 上被拆下
  // （首轮实测：element was detached from the DOM，点「最大化」卡到超时）。
  await page.waitForResponse(async (r) => {
    if (r.request().method() !== "GET" || !/\/agent-runs\/[^/]+$/.test(r.url())) return false;
    try {
      const body = await r.json() as { status?: string };
      return body.status === "succeeded" || body.status === "failed";
    } catch { return false; }
  }, { timeout: 120_000 });

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

/**
 * design-delta chat-diagram-artifact-reference（issue #1668）的核心验收线——直接
 * 反证 issue 描述的现象：「保存」→ 不刷新看到消息气泡内容已更新 → **整页 reload**
 * → 不点「最大化」→ 气泡只读预览依然是编辑后的版本（不是编辑前的原始文本）。
 *
 * 与上面那条 G2 e2e 的区别：上面验的是**modal 重开**时的读回（用户点了「最大化」）；
 * 这条验的是**只读预览本身**在「从未点过最大化」的整页刷新路径上是否也接上了 G1
 * 读回——这正是 issue 实测复现、此前唯一缺失的一段（`chat-diagram-fabric.tsx`/
 * `chat-canvas-fabric.tsx` 新增的「挂载滚入视口即读回」effect，见
 * `design-deltas/chat-diagram-artifact-reference/contract.md` §2.1）。
 *
 * 复用上面 G2（生成用户画像）同一条确定性生成路径构造出带 mermaid 围栏的 assistant
 * 消息——`chat-live-message-panel.tsx` 只对 `isAgent` 消息接 `MarkdownMessage`（人类
 * 自己发的消息走纯文本 `<p>`，没有 markdown 语义可渲染，实测确认，不是猜测）；
 * 确定性回声上游（`loopback-model-provider.ts`）的 `echoed` 首轮实测过不可靠——
 * 同一线程历史条目一多，它回显的不是这次真实发送的用户文本，而是某条更早的种子
 * 消息（上游自己的历史拼装问题，不是本 delta 的改动范围），生成的内容不可控，
 * 断言会踩到假红。G2 的 `summarizePersonaFromThread` 是本仓唯一确定性产出 mermaid
 * 消息的真实路径（`resultMessageId` 直接点名产出的那条消息，不靠猜）——上面那条
 * 用例已经把画像素材种进了同一条夹具线程，这里可以直接再触发一次（线程状态在同一
 * spec 文件内跨用例持久，素材仍然充分，`sufficient` 仍为 true）。
 *
 * 像素级对照（人类交付要求 §2）：保存后立即截一次只读预览、reload 后不点最大化
 * 再截一次，两次字节级相等（fabric 渲染在同一浏览器实例内对同一输入是确定性的）；
 * 都与最初原始内容的截图不相等，证明确实是「编辑生效」而不是巧合。
 */
test("只读预览挂载即读回：保存后立即可见 + reload 不点最大化也可见（issue #1668）", async ({ page }) => {
  test.setTimeout(180_000);

  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  await expect(page.getByTestId("chat-message-list")).toContainText("Controlled fixture message 01");

  // ── G2：再触发一次「生成用户画像」，产出一条新的 mindmap 消息（可编辑保存）──
  const personaResponse = page.waitForResponse((r) =>
    r.request().method() === "POST" && r.url().endsWith(`/chat/threads/${CHAT_READ_E2E.threadId}/persona-summary`));
  await page.getByTestId("chat-persona-summary-trigger").click();
  const personaOut = await (await personaResponse).json() as { resultMessageId: string; sufficient: boolean };
  expect(personaOut.sufficient).toBe(true);

  // 夹具线程有 51+ 条种子消息（本文件跨用例累加，实测已过百条），首页只显示最老的
  // 50 条——翻到底才能确定这条用例自己刚生成的新消息已经加载（见 `loadAllMessagePages`）。
  await loadAllMessagePages(page);

  const diagram = page.locator('[data-testid="chat-diagram-fabric"][data-diagram-type="mindmap"]').last();
  await diagram.scrollIntoViewIfNeeded();
  await expect(diagram).toHaveAttribute("data-ready", "true", { timeout: 30_000 });

  // 原始版截图（编辑前基线）。
  const originalScreenshot = await diagram.screenshot();

  // ── 最大化 → 编辑（＋节点）→ 保存 → 关闭（不 reload）─────────────────────
  await diagram.getByTestId("chat-diagram-maximize").click();
  const modal = page.getByTestId("chat-diagram-canvas-modal");
  await expect(modal).toBeVisible();
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

  await page.getByTestId("chat-diagram-close").click();
  await expect(modal).toHaveCount(0);

  // ── 不刷新：气泡只读预览应该立即反映编辑（PR #1696 已修的那段，本处回归钉死）──
  await expect(diagram).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  await page.waitForTimeout(1_500);
  await expect(diagram).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  const afterSaveNoReloadScreenshot = await diagram.screenshot();
  expect(afterSaveNoReloadScreenshot.equals(originalScreenshot)).toBe(false);

  // ── 整页 reload（穿透前端内存态）────────────────────────────────────────
  await page.reload();
  await expect(page.getByTestId("chat-message-list")).toContainText("Controlled fixture message 01");

  // 同上「挂载即读回」effect 本身也会在这次 reload 后立刻为**已经渲染出来的**
  // mindmap 图发一轮请求——但图要先翻页翻出来才谈得上「挂载」，这里先翻到底
  // （`loadAllMessagePages`），下面才轮到断言自动读回请求。
  await loadAllMessagePages(page);

  const diagram2 = page.locator('[data-testid="chat-diagram-fabric"][data-diagram-type="mindmap"]').last();

  // 关键断言：滚入视口后**不点任何按钮**，读回请求自动发出（挂载即读回，issue
  // #1668 修复的那条 effect）——这是「不是巧合」的直接证据，不只是看像素。
  const autoSourceRequest = page.waitForResponse((r) =>
    r.request().method() === "GET" && /\/artifacts\/[^/]+\/source/.test(r.url()), { timeout: 30_000 });
  await diagram2.scrollIntoViewIfNeeded();
  expect((await autoSourceRequest).status()).toBe(200);

  await expect(diagram2).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  // 自动读回命中后，`savedSource` 更新会让画布**重新**校验+渲染一轮（先是原始
  // 消息文本的初次渲染，`data-ready` 可能已经先翻过一次真；`previewCode` 换成
  // 保存版后 `markdownToCanvas` 再跑一遍才是最终要画的内容）——多等一拍，
  // 不靠 `data-ready` 这一次翻真就假定像素已经落定。
  await page.waitForTimeout(1_500);
  await expect(diagram2).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  const afterReloadNoClickScreenshot = await diagram2.screenshot();

  // 像素级对照（人类交付要求）：reload 后不点最大化，看到的仍是编辑后的版本——
  // 都与最初原始版截图不相等（内容真的变了，不是巧合）。
  expect(afterReloadNoClickScreenshot.equals(originalScreenshot)).toBe(false);
  expect(afterSaveNoReloadScreenshot.equals(originalScreenshot)).toBe(false);
  // 「保存后不刷新」与「reload 后不点最大化」两张截图不要求逐字节相等——同一份
  // mermaid 源两次独立渲染，画布容器宽度会因侧边栏/消息列表在两次快照之间的
  // 滚动条状态差 1-2px 而重算（`chat-diagram-fabric.tsx` 按
  // `container.getBoundingClientRect().width` 定宽），逐字节比对在真实浏览器里
  // 偏脆（首轮实测已踩过一次）。改用字节体量做近似——同一张图两次渲染，PNG
  // 体量应该高度接近；体量差远超合理阈值就说明画的根本不是同一份内容。
  const sizeRatio =
    Math.abs(afterReloadNoClickScreenshot.length - afterSaveNoReloadScreenshot.length)
    / Math.max(afterReloadNoClickScreenshot.length, afterSaveNoReloadScreenshot.length);
  expect(sizeRatio).toBeLessThan(0.15);
});
