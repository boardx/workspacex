import { test, expect, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * issue #2053 —— CK-P6「生成用户画像」/ CK-P8 归档线程只读态，真栈取证。
 *
 * ⚠ 2026-08-30 重设计：画像入口从恒定不变的独立按钮，改成建议行
 *   （`FollowUpSuggestions`）里按上下文出现/消失的一条本地 chip——归档时整条
 *   建议行不渲染（见场景二），未归档且线程已建立、还没生成过时才出现（见场景一）。
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

/**
 * ⚠ 每次探测都要有**自己的**超时，否则这个 poll 形同虚设。
 *
 * 首轮实测（本文件第二条用例）栽在这里：`page.request.get()` 不带 timeout 时用的是
 * Playwright 的默认值，Next dev server 正忙着编译路由时这一发请求可以挂很久——
 * `expect.poll` 的 `timeout: 60_000` 管的是"重试多久"，管不了"**一次**调用卡多久"，
 * 于是 poll 连第二次都没轮到就把整条用例 300s 的预算耗光了（报错行号指在 `.toBe(200)`，
 * 看起来像断言失败，实际是单发请求没返回）。
 * 每发限时 15s + 吞掉失败继续轮询，才是这个 poll 本来想表达的语义。
 */
async function warmUpCopilotRuntimeRoute(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          return (await page.request.get("/api/copilotkit/info", { timeout: 15_000 })).status();
        } catch {
          return 0; // 这一发超时/失败 ⇒ 继续下一轮，不让它吃掉整条用例的预算
        }
      },
      { timeout: 120_000, intervals: [500, 1_000, 2_000, 5_000] },
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

  // 反证基线：**生成之前**这条线程里一个图表块都没有（loopback 回复是纯文本）。
  // 没有这一条，下面"生成之后有图表块"就可能是别的东西本来就在，断言等于没断。
  await expect(page.getByTestId("chat-diagram-fabric")).toHaveCount(0);

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

  // 画像正文是 ```mermaid mindmap 围栏 —— 它进消息流后走
  // `MarkdownMessage → ChatDiagramFabric` 通道，被**画进 canvas**。
  //
  // ⚠ 因此不能断言消息区的**文字**里含 "mindmap"／"用户画像"：围栏源码渲染成图之后
  //   根本不在 textContent 里（本轮首跑就是这样红的，实测收到的可见文字是
  //   "fabric 渲染 · 只读预览最大化"）。要断言的是**图表块本身存在**，这也正是
  //   "围栏被正确识别并路由到 fabric 分支"这件事的直接证据。
  await expect(page.getByTestId("chat-diagram-fabric")).toHaveCount(1, { timeout: 60_000 });

  // 断言"刷新之后还在"：证明它真的落进了 chat_messages，不是只在内存里显示了一下。
  await page.goto(threadUrl);
  await expect(page.getByTestId("chat-diagram-fabric")).toHaveCount(1, { timeout: 60_000 });
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
  await expect(page.getByTestId("chat-task-workbench-composer-mic")).toBeDisabled();
  // 2026-08-30 重设计（人类原话「他应该是动态的建议的行为，不能是固定的」）：
  // 画像 chip 现在挂在建议行（`FollowUpSuggestions`）里，归档时整条建议行都不
  // 渲染——同追问 chip 的既有规则，不再是"渲染成灰色"。
  await expect(page.getByTestId("chat-persona-summary-trigger")).toHaveCount(0);

  // 反证：历史消息仍然读得到——归档是"只读"，不是"看不见"。
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(marker, { timeout: 30_000 });
});
