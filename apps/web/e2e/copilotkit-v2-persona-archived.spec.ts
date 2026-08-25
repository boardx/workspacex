import { test, expect, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * issue #2053 —— CK-P6「生成用户画像」/ CK-P8 归档线程只读态，真栈取证。
 *
 * 复用 `playwright.chat-read.config.ts` 的真栈编排（真登录 + 真 Postgres +
 * deep-agent loopback 替身 + `/api/copilotkit` 适配器），理由同
 * `copilotkit-v2-thread-persistence.spec.ts` 头注：这里需要的一切已经起好，不新起
 * 第二套 webServer。
 *
 * ## 场景一（CK-P6）打的是真链路，没有一处替身
 *
 * 发一条真消息 → 后端真建线程、真落 `chat_messages` → 外壳真调 `GET /chat/threads/:id`
 * 拿到真实 `capabilities`（个人线程含 `artifact.land`）⇒ 入口渲染 → 点击真调
 * `POST /chat/threads/:id/persona-summary` → 服务端真扫线程、真落一件产物、真写一条
 * assistant 消息（```mermaid mindmap 围栏）→ 前端把它接回消息流。
 *
 * 断言选的是**刷新之后**画像消息仍在：这是唯一能把"真的落库了"与"只在内存里显示
 * 了一下"分开的手法（同 #2021 持久化取证的同一条纪律）。只断言点完之后界面上
 * 出现了什么，一个纯前端伪造的实现照样绿。
 *
 * ## 场景二（CK-P8）为什么只能改一个布尔，以及为什么这不是造假
 *
 * `chat_threads.archived` 是真实字段、`getThread` 真实下发——**但契约里没有任何
 * 把线程置为归档的操作**（`mutateThread.in.op` 只有 `create | rename | delete`，
 * 读 `packages/contracts/src/chat.ts` 确认）。也就是说：今天不存在任何一条用户
 * 动作能把一条线程变成归档态，端到端"真的归档一条线程再看界面"这件事**在产品里
 * 不存在**，不是这个测试偷懒。
 *
 * 所以这里的做法是：让请求真的打到服务端、拿到**服务端真实返回的那个响应体**，
 * 只把其中 `thread.archived` 这一个布尔翻成 `true` 再交给前端。它证明的命题是
 * 精确的——「前端对 `getThread` 下发的这个真实字段做出正确反应」；它**不**声称
 * 「归档写路径存在」，那个缺口在 issue #2053 与外壳头注里都如实登记了。响应体的
 * 其余部分（消息、rightTabs、capabilities）全部是服务端真给的，没有编造。
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
      async () => (await page.request.get("/api/copilotkit/info")).status(),
      { timeout: 60_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(200);
}

/** 发一条消息并等回合收尾（消息真正落库），返回带真实 threadId 的地址。 */
async function sendFirstTurn(page: Page, text: string): Promise<string> {
  await page.getByTestId("copilotkit-v2-input").fill(text);
  await page.getByTestId("copilotkit-v2-send").click();
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(text, { timeout: 60_000 });
  await expect(page).toHaveURL(/\/chat\/[^/]+$/, { timeout: 60_000 });
  await page.waitForTimeout(15_000);
  return page.url();
}

test("CK-P6：真实线程上生成用户画像 → mindmap 消息落库，刷新后仍在", async ({ page }) => {
  await login(page);
  await warmUpCopilotRuntimeRoute(page);
  await page.goto("/chat");

  const marker = `CK-P6-画像-${Date.now()}`;
  const threadUrl = await sendFirstTurn(page, marker);

  // 入口的渲染依据是服务端真实下发的 `capabilities`（个人线程含 artifact.land），
  // 不是前端写死——外壳的 getThread 读回之后它才出现。
  const trigger = page.getByTestId("chat-persona-summary-trigger");
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await expect(trigger).toBeEnabled({ timeout: 30_000 });

  await trigger.click();

  // 失败横幅若出现，直接把 reasonCode 暴露在失败信息里（不让它静默）。
  const failure = page.getByTestId("chat-persona-summary-error");
  await expect
    .poll(
      async () => {
        if (await failure.isVisible()) return `FAILED:${await failure.textContent()}`;
        return (await trigger.textContent())?.includes("生成画像中") === true ? "running" : "settled";
      },
      { timeout: 120_000, intervals: [1_000, 2_000, 3_000] },
    )
    .toBe("settled");
  await expect(failure).toBeHidden();

  // 画像正文是 mermaid mindmap 围栏 —— 它进消息流后走 MarkdownMessage 的图表通道。
  // 断言"刷新之后还在"：证明它真的落进了 chat_messages，不是只在内存里显示了一下。
  await page.goto(threadUrl);
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(/用户画像|mindmap/i, {
    timeout: 60_000,
  });
});

test("CK-P8：getThread 真实响应的 archived=true ⇒ composer 全部写入口禁用 + 只读说明", async ({ page }) => {
  await login(page);
  await warmUpCopilotRuntimeRoute(page);
  await page.goto("/chat");

  const marker = `CK-P8-归档-${Date.now()}`;
  const threadUrl = await sendFirstTurn(page, marker);

  // 见文件头注：请求真的打到服务端，只把真实响应体里 thread.archived 这一个布尔翻过来。
  await page.route("**/chat/threads/**", async (route) => {
    const request = route.request();
    if (request.method() !== "GET" || /\/messages(\?|$)/.test(new URL(request.url()).pathname)) {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    if (response.status() !== 200) {
      await route.fulfill({ response });
      return;
    }
    const body = await response.json();
    if (body?.thread === undefined) {
      await route.fulfill({ response });
      return;
    }
    await route.fulfill({ response, json: { ...body, thread: { ...body.thread, archived: true } } });
  });

  await page.goto(threadUrl);

  await expect(page.getByTestId("chat-composer-archived")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("copilotkit-v2-input")).toBeDisabled();
  await expect(page.getByTestId("copilotkit-v2-send")).toBeDisabled();
  await expect(page.getByTestId("chat-mic-button")).toBeDisabled();
  await expect(page.getByTestId("chat-persona-summary-trigger")).toBeDisabled();

  // 反证：历史消息仍然读得到——归档是"只读"，不是"看不见"。
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(marker, { timeout: 30_000 });
});
