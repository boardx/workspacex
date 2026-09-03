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
 *
 * issue #1610 —— 本文件两条用例共用 `CHAT_READ_E2E.diagramRoundtripThreadId` 这条
 * **专属**线程（放在 `restructureProjectId`，零预置消息），不再复用
 * `chat-read.spec.ts` 也依赖的共享 `threadId`（51 条消息夹具线程）。此前共写同一条
 * 线程时，本文件字母序排在 `chat-read.spec.ts` 之前、单 worker 串行执行，本文件落地
 * 的产物会撑高共享线程的消息区总高度，让 `chat-read.spec.ts:4`
 * 「发消息后自动滚到底」那条断言是否变红取决于两个 spec 之间的执行时刻间隔——一场
 * 侥幸通过的时序竞态，不是真正的隔离。给每个关注点一条专属线程零预置消息，是
 * #1324 起确立的既有惯例（`skillMountThreadId`/`causalCheckThreadId`/
 * `attachmentPreviewThreadId` 等同一套模式），这里第一次把它接到本文件。
 */
import { expect, test, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
// ⚠ 从产品代码 import 那个 key，不在这里再写一份字面量——鉴权是
//   `Authorization: Bearer <token>`（不是 cookie），token 存在 localStorage 的这个键下。
//   见 `chat-agent-skill-context.spec.ts` 同一模式。
import { SESSION_TOKEN_STORAGE_KEY } from "../lib/api-client";

/** `page.request` 不会自动带上身份（Bearer，不是 cookie）——直连 API 时要显式带这个头。 */
async function authHeaders(page: Page): Promise<Record<string, string>> {
  const token = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_TOKEN_STORAGE_KEY);
  expect(token, "登录之后 localStorage 里应有 session token").toBeTruthy();
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

/**
 * G2「生成用户画像」composer 按钮已下线（人类实测反馈：固定占一整行，误导用户）——
 * 这条 e2e 复用的不是 UI 入口，是它背后仍然保留的 `POST .../persona-summary` 端点，
 * 直连 API 产出确定性 mermaid 消息（理由见文件头注：本仓唯一确定性产出 mindmap 消息
 * 的真实路径，`chat-diagram-fabric` 只对 `isAgent` 消息接 markdown 渲染）。
 * 锚点 `messageId`（契约必传）取线程当前最新一条消息——与原按钮实现同一条取值规则
 * （`messages[messages.length - 1]`），这里改用真实 GET 读回，不猜。
 */
async function triggerPersonaSummary(
  page: Page,
  threadId: string,
): Promise<{ resultMessageId: string; sufficient: boolean }> {
  const headers = await authHeaders(page);
  const messagesRes = await page.request.get(`/chat/threads/${threadId}/messages?limit=100`, { headers });
  expect(messagesRes.ok()).toBe(true);
  const { messages } = await messagesRes.json() as { messages: Array<{ id: string }> };
  const anchor = messages[messages.length - 1];
  expect(anchor, "触发画像生成前线程需要至少一条消息作为锚点").toBeTruthy();

  const res = await page.request.post(`/chat/threads/${threadId}/persona-summary`, {
    headers,
    data: { threadId, messageId: anchor!.id },
  });
  expect(res.ok()).toBe(true);
  return res.json();
}

/**
 * 反复点「加载更早之后的消息」直到按钮消失或不再出现——真的翻到底，不是「翻出了
 * 某张目标图就提前停」（本文件跨用例共用同一条夹具线程、消息数会累加，「某个
 * mindmap 图出现了」不能保证是**这一条用例自己刚生成的那条**，只有翻到底才能确定
 * 最新消息已经加载）。
 *
 * 2026-08-22 更新（issue #728 round 2 独评发现的 H3 阻塞回归修复，见
 * `chat-live-message-panel.tsx` `catchUpCursorRef` 头注）：修复前，软重读追新起点
 * 用服务端 `nextCursor`，一旦线程被追到底就会塌成 `null`、下一次软重读又把它错误地
 * 解释成"从头再来"重新拉第一页——这既会把 `nextCursor` 弹回非空造成按钮反复
 * 挂载/卸载（点它时无限 `element was detached from the DOM, retrying` 直到测试
 * 预算耗尽），也意味着"翻到底"永远等不到真正发生。
 *
 * 修复后，发送 / run 终态 / 生成画像触发的软重读会用本地列表尾部现算的游标，
 * 自己就能把分页追到底——**按钮往往在测试走到这一步之前就已经不存在**（真实
 * 复现：G2 流程跑完时全部 51+3 条消息已经在 DOM 里，从未出现过按钮）。这个 helper
 * 因此要同时处理「按钮从未出现过」（`count()===0` 立即返回，不算失败）与「按钮还
 * 在但翻页过程中瞬时 detach」（重试外壳，每轮重新定位再点，吃掉瞬时 detach）两种
 * 情况——不能再假设按钮必然会出现一次。
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

  // ── 登录并进入专属线程（issue #1610：不再复用 chat-read.spec.ts 共写的 threadId）──
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.restructureProjectId}&thread=${CHAT_READ_E2E.diagramRoundtripThreadId}`);
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.diagramRoundtripThreadId}`)).toBeVisible();

  // ── 种画像素材：persona 文本语法逐字进线程正文（发真实消息，不注入 DB）──
  const input = page.getByRole("textbox", { name: "消息内容" });
  await input.fill("姓名: 陈静\n## 目标和需求\n- 确保订单准时交付率稳定在95%以上");
  const accepted = page.waitForResponse((r) =>
    r.request().method() === "POST" && r.url().endsWith(`/chat/threads/${CHAT_READ_E2E.diagramRoundtripThreadId}/messages`));
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

  // ── G2：触发「生成用户画像」——composer 按钮已下线（占一整行、人类实测判定为
  // 误操作入口），直连背后仍保留的端点（见文件头注 `triggerPersonaSummary`）。
  // assistant mindmap 消息落库，但直连 API 不经过面板的软重读——reload 换取「消息
  // 面板重新从服务端整页拉取」，不假装 UI 触发过一次它没有触发的软重读。
  const personaOut = await triggerPersonaSummary(page, CHAT_READ_E2E.diagramRoundtripThreadId);
  expect(personaOut.sufficient).toBe(true);
  expect(typeof personaOut.resultMessageId).toBe("string");

  await page.reload();
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.diagramRoundtripThreadId}`)).toBeVisible();

  // 这条专属线程消息数远不到分页阈值，首屏即可加载到全部消息；`loadAllMessagePages`
  // 仍保留作为通用兜底（按钮不存在就立即返回，见该 helper 头注）。
  await loadAllMessagePages(page);

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
    r.request().method() === "POST" && r.url().endsWith(`/chat/threads/${CHAT_READ_E2E.diagramRoundtripThreadId}/artifacts`));
  await page.getByTestId("chat-diagram-save").click();
  expect((await landResponse).status()).toBe(200);
  await expect(page.getByTestId("chat-diagram-saved")).toBeVisible();
  const savedSource = await page.getByTestId("chat-diagram-saved-source").textContent();
  expect(savedSource).toContain("新节点");

  // ── 关闭 modal，**整页 reload**（穿透前端内存态）────────────────────────
  await page.getByTestId("chat-diagram-close").click();
  // issue #2283 根因修复：本文件改用专属零预置消息线程（e85cf9b3/#2261）之后，
  // reload 后线程里只有寥寥几条消息，mindmap 图不再需要翻页/滚动才能进视口——
  // 它在整页刷新后几乎立刻满足 `chat-diagram-fabric.tsx`「挂载即读回」effect 的
  // `IntersectionObserver`（`rootMargin: 200px`）条件，自己发一次
  // `GET .../artifacts/:id/source`，读回成功后用 `key={previewCode}` 把
  // `DiagramCanvasBody` 整个换挂一次（该文件头注释「根因修复」一节）。旧的共享
  // 夹具线程有 51+ 条消息，这张图要靠 `loadAllMessagePages` 的多轮点击才能翻到
  // 视口，天然给了这次异步读回+换挂充分的时间窗；专属线程去掉了这个天然缓冲，
  // 换挂随时可能撞上 `diagram2.scrollIntoViewIfNeeded()` 正在操作的那个元素实例
  // （`Element is not attached to the DOM`，issue #2283 记录的 `:61` 红）。
  // 修法：把这次挂载即读回的 GET 显式等到位（与下面第二个用例同一根因、同一
  // 修法：监听器必须在触发它的导航/操作之前注册，才能追上这个几乎立即发生的
  // 请求），确认换挂已经落定，再去定位/操作 `diagram2`——不是给这一步加重试或
  // 放宽超时掩盖竞态，是让测试真正等到那个会导致 DOM 换挂的异步副作用完成。
  const mountReadback = page.waitForResponse((r) =>
    r.request().method() === "GET" && /\/artifacts\/[^/]+\/source/.test(r.url()), { timeout: 30_000 });
  await page.reload();
  // 这条线程零预置消息（issue #1610 隔离），锚点换成 reload 后专属线程会话卡仍可见 +
  // 本用例自己发的第一条真实消息，而不是共享夹具线程才有的
  // "Controlled fixture message 01"。
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.diagramRoundtripThreadId}`)).toBeVisible();
  await expect(page.getByTestId("chat-message-list")).toContainText("陈静");
  // 整页 reload 后是全新挂载（前端内存态清零）：分页从第一页重新开始，还没有任何
  // 软重读追新过，按钮这次理应存在——仍用 `loadAllMessagePages` 而不是裸
  // `.click()`，翻页过程中偶发的瞬时 detach 由它的重试外壳吃掉。
  await loadAllMessagePages(page);
  // 挂载即读回的换挂已经完成——现在再去抓 `diagram2` 拿到的是换挂后稳定的实例。
  await mountReadback;

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
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.restructureProjectId}&thread=${CHAT_READ_E2E.diagramRoundtripThreadId}`);
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.diagramRoundtripThreadId}`)).toBeVisible();
  // 这条专属线程从零预置消息开始，跨用例状态在同一 spec 文件内持久（issue #1610
  // 隔离的是「与别的 spec 文件共写」，不是「同一 spec 文件内的用例互相独立」）——
  // 上面那条用例已经把画像素材种进了这条线程，这里可以直接复用。
  await expect(page.getByTestId("chat-message-list")).toContainText("陈静");

  // ── G2：再触发一次「生成用户画像」，产出一条新的 mindmap 消息（可编辑保存）──
  // composer 按钮已下线，直连端点（见文件头注 `triggerPersonaSummary`），reload
  // 换取消息面板重新整页拉取。
  const personaOut = await triggerPersonaSummary(page, CHAT_READ_E2E.diagramRoundtripThreadId);
  expect(personaOut.sufficient).toBe(true);

  await page.reload();
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.diagramRoundtripThreadId}`)).toBeVisible();

  // 这条专属线程消息数远不到 50 条分页阈值（上一条用例只发了几条消息），这里仍走
  // `loadAllMessagePages`——按钮不存在就立即返回（见该 helper 头注），不依赖具体
  // 消息数，翻页/不翻页两种情况都能正确定位到最新消息。
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
    r.request().method() === "POST" && r.url().endsWith(`/chat/threads/${CHAT_READ_E2E.diagramRoundtripThreadId}/artifacts`));
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
  //
  // 关键断言：滚入视口后**不点任何按钮**，读回请求自动发出（挂载即读回，issue
  // #1668 修复的那条 effect）——这是「不是巧合」的直接证据，不只是看像素。
  //
  // 2026-08-22 修复（trace 实测钉死的根因，与 H3/#1781 无关）：这个监听器此前注册
  // 在 `loadAllMessagePages` **之后**、`scrollIntoViewIfNeeded` 之前——但产线那条
  // 「挂载即读回」effect 实际在图表一进入视口就立刻发请求，不等这里显式调用
  // `scrollIntoViewIfNeeded`；图表是本例线程最新一条消息，翻页翻到底（`load-more`
  // 把它从服务端拉回来并挂载）那一刻它就已经进入视口触发了 effect。trace 时间线
  // 实测：`GET .../source` 响应发生在 `loadAllMessagePages` 循环内部（load-more
  // 点击之后），比这里旧位置的 `page.waitForResponse` 注册早了近 500ms——监听器
  // 挂上时事件已经过去，Playwright 的 `waitForResponse` 只等**未来**事件，于是
  // 30s 后必然超时。不是产线 effect 没触发，是测试自己的监听器挂晚了。
  //
  // issue #2283 二次根因（同一症状，新的时机来源）：#2261 把本文件改成专属零
  // 预置消息线程之后，reload 时线程消息数很少，这张图**在初始渲染时就已经在
  // 视口内**（`IntersectionObserver` `rootMargin: 200px` 立即命中），不需要
  // `loadAllMessagePages` 翻页/点击才能把它带进视口——`GET .../artifacts/:id/
  // source` 可能在 `page.reload()` 触发的这次导航刚完成、`chat-message-list`
  // 断言刚轮询到文本命中的那一瞬间就已经发出甚至已经收到响应，比上面 2026-08-22
  // 那次修复把监听器放的位置（`page.reload()` 之后两个 `expect` 之后）还要早。
  // 旧的共享夹具线程有 51+ 条消息，这张图天然要靠 `loadAllMessagePages` 的多轮
  // 点击才能翻到视口，把这次请求推迟到监听器已经就位之后——专属线程去掉了这个
  // 天然缓冲。修法：把监听器再往前挪到 `page.reload()` 之前注册——不论请求发生
  // 在导航期间、reload 后的断言轮询期间、还是 `loadAllMessagePages` 循环内部，
  // 全部落在监听范围内。不是加超时或 retry，是让监听器真正先于它要等的事件存在。
  const autoSourceRequest = page.waitForResponse((r) =>
    r.request().method() === "GET" && /\/artifacts\/[^/]+\/source/.test(r.url()), { timeout: 30_000 });

  await page.reload();
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.diagramRoundtripThreadId}`)).toBeVisible();
  await expect(page.getByTestId("chat-message-list")).toContainText("陈静");

  await loadAllMessagePages(page);

  // 挂载即读回不需要等这里显式调用 `scrollIntoViewIfNeeded`——`IntersectionObserver`
  // 的 `rootMargin: 200px` 会在图表进入「视口附近」（不必真的完全可见）时就提前
  // 命中，专属线程消息很少，这几乎在 reload 后立刻发生。先把这次读回等到位（连带
  // 它触发的 `key={previewCode}` 换挂一起等完），再去定位/滚动 `diagram2`——避免
  // `scrollIntoViewIfNeeded` 抓到的元素在操作过程中被换挂摘掉（issue #2283
  // 记录的 `:61`「Element is not attached to the DOM」，与上面第一个用例同一
  // 根因、同一修法：不是给这一步加重试，是把顺序换成先等异步副作用完成）。
  expect((await autoSourceRequest).status()).toBe(200);

  const diagram2 = page.locator('[data-testid="chat-diagram-fabric"][data-diagram-type="mindmap"]').last();
  await diagram2.scrollIntoViewIfNeeded();

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
