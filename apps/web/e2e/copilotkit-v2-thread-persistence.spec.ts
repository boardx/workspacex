import { test, expect, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * issue #2021 —— `/chat/copilotkit-v2` 消息持久化 + 多线程管理。
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
  await page.goto("/chat/copilotkit-v2");

  const marker = `DA-2021-刷新持久化-${Date.now()}`;
  await sendAndWaitEcho(page, marker);

  // 地址栏必须已经从裸路由换成带真实 threadId 的那一条——`window.history.replaceState`
  // 生效的直接证据，不是靠"消息还在"反推。
  await expect(page).toHaveURL(/\/chat\/copilotkit-v2\/[^/]+$/);
  const urlAfterFirstTurn = page.url();

  await page.reload();

  // 刷新后地址栏原样保留（服务端渲染的动态段本来就该是这个值，不需要再次跳转）。
  expect(page.url()).toBe(urlAfterFirstTurn);
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(marker, { timeout: 30_000 });
});

test("新建对话→线程列表出现两条→切换回第一条→历史正确恢复", async ({ page }) => {
  await login(page);
  await warmUpCopilotRuntimeRoute(page);
  await page.goto("/chat/copilotkit-v2");

  const firstMarker = `DA-2021-线程一-${Date.now()}`;
  await sendAndWaitEcho(page, firstMarker);
  await expect(page).toHaveURL(/\/chat\/copilotkit-v2\/[^/]+$/);
  const firstThreadUrl = page.url();
  const firstThreadId = firstThreadUrl.split("/").pop()!;

  // 新建对话：侧栏「+ 新建对话」按钮，走真实 `POST /chat/threads/mutate` + 导航。
  await page.getByTestId("chat-thread-create").click();
  await page.waitForURL(/\/chat\/copilotkit-v2\/[^/]+$/);
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
