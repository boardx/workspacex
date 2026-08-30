import { test, expect, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * issue #2021 —— `/chat` 消息持久化 + 多线程管理。
 *
 * 复用同一份真栈编排（真登录 + 真 Postgres + deep-agent loopback 替身），见
 * `playwright.chat-read.config.ts` 文件头"为什么新 spec 挂在本 config 下"的一贯理由：
 * 这里需要的一切（真登录账号、确定性回复上游、`/api/copilotkit` 适配器）已经起好，
 * 不新起第二套 webServer 编排。
 *
 * ## 断言的是什么，为什么这样断言
 *
 * 1. 发消息 → 刷新整页（`page.reload()`，不是 SPA 内导航）→ 断言用户消息与
 *    assistant 回复原文仍在 DOM 里。这是唯一能证明"持久化"而不是"内存态凑巧还活着"
 *    的手法——SPA 内导航不会清空 `agent.messages`，只有真实整页刷新才会。
 * 2. 新建第二条对话 → 断言线程列表出现两条卡片 → 点击第一条卡片切回 → 断言历史
 *    消息（第一条对话的用户原话）正确恢复，且第二条对话的用户原话**不**出现在
 *    第一条对话的消息区（证明不是"随便读了点什么回来"，是读对了具体那一条线程）。
 *
 * `loopback-deep-agent-provider.ts` 的默认剧本把用户原话逐字嵌进最终回复
 * （见 `copilotkit-v2-runtime-adapter.spec.ts` 头注"回显用户原文"），所以直接断言
 * 消息区包含发送的原始文字，不需要额外解析 wire 帧。
 */
test.setTimeout(300_000);

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);
}

async function warmUpCopilotRuntimeRoute(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/api/copilotkit/info");
        return res.status();
      },
      { timeout: 60_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(200);
}

/** 发一条消息并等到消息区里出现该原文（用户气泡先到，早于 assistant 回复）。 */
async function sendAndWaitEcho(page: Page, text: string): Promise<void> {
  await page.getByTestId("copilotkit-v2-input").fill(text);
  await page.getByTestId("copilotkit-v2-send").click();
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(text, { timeout: 60_000 });
  // 给 assistant 回合收尾（run 落 `succeeded`，消息真正落库）留够时间——与既有
  // copilotkit-v2-*.spec.ts 同一数量级的观测窗（`copilotkit-v2-suggestions.spec.ts`
  // 用的是 12s；这里发生的是一次完整持久化写入，多给一点）。
  await page.waitForTimeout(15_000);
}

test("发消息→整页刷新→消息仍在（URL 绑定的持久化 chatThreadId）", async ({ page }) => {
  await login(page);
  await warmUpCopilotRuntimeRoute(page);
  await page.goto("/chat");

  const marker = `DA-2021-刷新持久化-${Date.now()}`;
  await sendAndWaitEcho(page, marker);

  // 地址栏必须已经从裸路由换成带真实 threadId 的那一条——`window.history.replaceState`
  // 生效的直接证据，不是靠"消息还在"反推。
  await expect(page).toHaveURL(/\/chat\/[^/]+$/);
  const urlAfterFirstTurn = page.url();

  await page.reload();

  // 刷新后地址栏原样保留（服务端渲染的动态段本来就该是这个值，不需要再次跳转）。
  expect(page.url()).toBe(urlAfterFirstTurn);
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(marker, { timeout: 30_000 });
});

test("新建对话→线程列表出现两条→切换回第一条→历史正确恢复", async ({ page }) => {
  await login(page);
  await warmUpCopilotRuntimeRoute(page);
  await page.goto("/chat");

  const firstMarker = `DA-2021-线程一-${Date.now()}`;
  await sendAndWaitEcho(page, firstMarker);
  await expect(page).toHaveURL(/\/chat\/[^/]+$/);
  const firstThreadUrl = page.url();
  const firstThreadId = firstThreadUrl.split("/").pop()!;

  // 新建对话：侧栏「+ 新建对话」按钮，走真实 `POST /chat/threads/mutate` + 导航。
  await page.getByTestId("chat-thread-create").click();
  await page.waitForURL(/\/chat\/[^/]+$/);
  await expect(page).not.toHaveURL(firstThreadUrl);

  const secondMarker = `DA-2021-线程二-${Date.now()}`;
  await sendAndWaitEcho(page, secondMarker);
  const secondThreadUrl = page.url();
  const secondThreadId = secondThreadUrl.split("/").pop()!;
  expect(secondThreadId).not.toBe(firstThreadId);

  // 侧栏线程列表至少出现这两条真实线程（不是"恰好两条"——同一账号在别的 spec/历史
  // 运行里可能已经建过其它个人线程，断言"至少包含这两个 id"比断言总数更不脆弱）。
  await expect(page.getByTestId(`chat-thread-${firstThreadId}`)).toBeVisible();
  await expect(page.getByTestId(`chat-thread-${secondThreadId}`)).toBeVisible();

  // 切回第一条：点击侧栏卡片，真实路由导航（不是 SPA 内状态切换），面板整体
  // remount 后从服务端回读历史。
  await page.getByTestId(`chat-thread-${firstThreadId}`).click();
  await page.waitForURL(firstThreadUrl);
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(firstMarker, { timeout: 30_000 });
  // 反证：第一条线程的消息区不应该混入第二条线程的用户原话——证明历史读取按
  // 具体线程 id 隔离，不是"读到了点什么就当作对"。
  await expect(page.getByTestId("copilotkit-v2-messages")).not.toContainText(secondMarker);
});

/**
 * issue #2259 —— rev-e2e 真栈实测：`/chat` **裸路由落地**（`selectedThreadId`
 * 初始为 `null`，不是"已经在某条线程页面上再切到另一条"）时点击侧栏已有对话，
 * 主面板不切换、地址栏不变。
 *
 * 上面那条「新建对话→切换回第一条」用例**不会**复现这个缺口：它两次点击发生时
 * 当前地址栏都**已经带着某条线程 id**（`selectedThreadId` 非空）。真实用户最常见
 * 的路径反而是"打开 `/chat` 主入口 → 侧栏里全是历史对话 → 点一条进去"——落地那一刻
 * `initialThreadId === null`。这里专门复现这条路径：先建一条线程留下痕迹，
 * 再显式 `page.goto("/chat")` 回到裸路由（不是 SPA 内导航），然后点侧栏那条卡片。
 */
test("裸路由 /chat 落地（未选中任何线程）时点击侧栏已有对话 ⇒ 真实导航切换到该线程", async ({ page }) => {
  await login(page);
  await warmUpCopilotRuntimeRoute(page);
  await page.goto("/chat");

  const marker = `DA-2259-裸路由点击-${Date.now()}`;
  await sendAndWaitEcho(page, marker);
  await expect(page).toHaveURL(/\/chat\/[^/]+$/);
  const threadUrl = page.url();
  const threadId = threadUrl.split("/").pop()!;

  // 显式回到裸路由——`initialThreadId` 由 `/chat/page.tsx` 传 `null`，
  // `selectedThreadId` 因此初始为 `null`，这正是 issue #2259 复现的落地态。
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByTestId(`chat-thread-${threadId}`)).toBeVisible();

  await page.getByTestId(`chat-thread-${threadId}`).click();
  await page.waitForURL(threadUrl, { timeout: 15_000 });
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(marker, { timeout: 30_000 });
});

/**
 * issue #2402 —— 人类实测反馈：切换会话时左侧会话列表随整页一起重新进入 loading
 * 骨架态，不应该发生；只有右侧内容面板应该切换。#2067/#2378 之前两次都只收窄了
 * `pushThreadRoute` 判断软导航是否成功的判据，没有堵住"判据到点后退化成
 * `window.location.assign` 整页硬导航"这个洞本身——那才是唯一会连累左栏的路径。
 *
 * 这条用例直接在真实浏览器里断言"没有整页硬导航发生"，不依赖判据本身准不准：
 *   1. 点击切换前在 `window` 上打一个探针 + 一个 MutationObserver，专门数
 *      `[data-testid="loading"]`（左栏骨架屏，见 `copilotkit-v2-shell.tsx`）出现
 *      过几次。`window.location.assign` 会整页重载、创建全新的 `window`，探针和
 *      observer 都会随之消失/清零；只有 `router.push` 这类 SPA 内软导航才会让探针
 *      原样存活到点击之后。
 *   2. 切换完成后断言：探针还在（=== 全程没有发生过一次整页硬导航）、骨架屏
 *      一次都没出现过（=== 左栏没有被重新挂载/重新进入 loading 态）。
 */
test("已选中某条线程时切换到另一条 ⇒ 不发生整页硬导航，左栏骨架屏全程不出现", async ({ page }) => {
  await login(page);
  await warmUpCopilotRuntimeRoute(page);
  await page.goto("/chat");

  const firstMarker = `DA-2402-左栏A-${Date.now()}`;
  await sendAndWaitEcho(page, firstMarker);
  await expect(page).toHaveURL(/\/chat\/[^/]+$/);
  const firstThreadUrl = page.url();
  const firstThreadId = firstThreadUrl.split("/").pop()!;

  await page.getByTestId("chat-thread-create").click();
  await page.waitForURL(/\/chat\/[^/]+$/);
  const secondMarker = `DA-2402-左栏B-${Date.now()}`;
  await sendAndWaitEcho(page, secondMarker);
  const secondThreadUrl = page.url();

  await expect(page.getByTestId(`chat-thread-${firstThreadId}`)).toBeVisible();

  // 探针：只有真的没发生整页硬导航，这几个标记才会原样存活到点击之后。
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__wsxNavProbe = true;
    (window as unknown as Record<string, unknown>).__wsxLoadingSeen = 0;
    const observer = new MutationObserver(() => {
      if (document.querySelector('[data-testid="loading"]')) {
        const w = window as unknown as Record<string, number>;
        w.__wsxLoadingSeen = (w.__wsxLoadingSeen ?? 0) + 1;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    (window as unknown as Record<string, unknown>).__wsxObserver = observer;
  });

  await page.getByTestId(`chat-thread-${firstThreadId}`).click();
  await page.waitForURL(firstThreadUrl, { timeout: 15_000 });
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(firstMarker, { timeout: 30_000 });

  const probeSurvived = await page.evaluate(
    () => (window as unknown as Record<string, unknown>).__wsxNavProbe === true,
  );
  expect(probeSurvived).toBe(true);
  const loadingSeen = await page.evaluate(
    () => (window as unknown as Record<string, number>).__wsxLoadingSeen,
  );
  expect(loadingSeen).toBe(0);

  // 反证：不是"读到了点什么就当作对"——第二条线程的用户原话不该混进第一条。
  await expect(page.getByTestId("copilotkit-v2-messages")).not.toContainText(secondMarker);
  void secondThreadUrl; // 仅用于建第二条线程留下真实痕迹，不需要再断言其地址栏
});
