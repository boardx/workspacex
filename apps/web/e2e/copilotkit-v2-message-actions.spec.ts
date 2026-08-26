import { test, expect, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * CK-P3 + CK-P4（issue #2054）—— v2 轨道逐条消息操作与 run 进度的真栈取证。
 *
 * 差距单一事实源：`.harness/state/chat-feature-parity-gap-2026-08-25.md` 第 7、9 项。
 *
 * ## 这个文件要证明的是「真的发生了」，不是「按钮画出来了」
 *
 * 三条断言各自对应一个此前**没有任何测试覆盖、因此可以假实现而不被发现**的点：
 *
 *   ① **复制**：断言的是**剪贴板里真的有那段文字**（`navigator.clipboard.readText()`），
 *      不是"点击后出现了对勾"。对勾是本仓自己画的，它可以在复制失败时照样出现。
 *   ② **评分**：断言的是 wire 上 `POST /messages/:id/rating` 的**响应状态**。
 *      这一条是本任务全部风险的所在：`submit-message-rating.ts` 对查不到的
 *      messageId 一律 404，而 v2 流式消息在视图里的 id 是控制器 `randomUUID()` 出来的
 *      临时聚合 id。如果 `chat_message_id` 回显没接上、或者接错了，按钮照样画得出来、
 *      点得下去，只是每次都 404——所以这里显式断言 `not 404`，不只断言"UI 显示已记录"。
 *   ③ **重试**：断言的是**产生了一次新的 run 请求**（wire 上 `POST /api/copilotkit/...`
 *      的计数增加），不是"横幅消失了"。一个把 error state 清掉的假重试会让横幅消失。
 *
 * ## 为什么先选一个真实 agent
 *
 * 「对 agent 提反馈」按钮按设计只在**知道是哪个 agent** 时才画（`actingAgentId !== null`；
 * 见 `copilotkit-v2-message-actions.tsx` 文件头：反馈要能一直对上同一个 agent，对不上
 * 就不采集）。裸进 `/chat` 时用户还没选，走服务端配置的默认 agent，前端拿不到它的 id。
 * 所以这里显式选中 `CHAT_READ_E2E.agentId`——这既是反馈按钮真实的出现条件，也顺带让
 * 回复来自确定性的 loopback provider（`agentReplyPrefix` 可核对）。
 */

const RUN_ROUTE = /\/api\/copilotkit\//;

async function warmUpCopilotRuntimeRoute(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/chat");
        return res.status();
      },
      { timeout: 180_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toBe(200);
}

async function loginAndOpenChat(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);
  await warmUpCopilotRuntimeRoute(page);
  await page.goto("/chat");
}

async function selectLoopbackAgent(page: Page): Promise<void> {
  // issue #2130（TW-P0-2）—— 入口从裸的 `AgentPicker`（`chat-agent-select`）换成
  // 「选择能力」（`chat-task-workbench-capability-picker`），同一个真实下拉；
  // 候选项现在共用一个字面量 testid（判据要求），按真实 agent id 精确点中用
  // `data-agent-id`，见 `chat-task-workbench-capability-picker.tsx` 头注。
  const trigger = page.getByTestId("chat-task-workbench-capability-picker");
  await expect(trigger).toBeVisible({ timeout: 20_000 });
  await trigger.click();
  await expect(page.getByTestId("chat-agent-select-listbox")).toBeVisible();
  await page.locator(`[data-testid="chat-task-workbench-capability-card"][data-agent-id="${CHAT_READ_E2E.agentId}"]`).click();
  await expect(page.getByTestId("chat-agent-select-listbox")).toBeHidden();
}

test.setTimeout(180_000);

test("CK-P3 逐条消息操作——复制真进剪贴板、评分 POST 真被服务端接受（非 404）、反馈入口按 agent 归因", async ({
  page,
  context,
}) => {
  // 读剪贴板需要显式授权；写入不需要，但断言"真的写进去了"必须能读回来。
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  await loginAndOpenChat(page);
  await selectLoopbackAgent(page);

  const userText = "issue #2054 消息级操作取证";
  await page.getByTestId("copilotkit-v2-input").fill(userText);

  // ── CK-P4 进度行：run 在途期间"已用 N 秒"真的出现 ────────────────────────────
  // ⚠ 监听必须在 click **之前**就挂上。进度行是**瞬态**的：loopback 一轮只要一两秒，
  //   而 `expect(...).toBeVisible()` 是"点完之后才开始轮询"——中间那段间隙里进度行
  //   完全可能出现又收场，于是断言看到的是一个已经正确收尾的界面，却报 element not
  //   found。第一版就是这么写的，前两轮侥幸绿、rebase 后机器慢下来当场红（不是代码
  //   回归：`runProgress` 接线一行没动）。`waitForSelector` 在 click 前建立订阅，
  //   没有这段间隙。
  const thinkingAppeared = page.waitForSelector(
    "[data-testid=\"copilotkit-v2-thinking-elapsed\"]",
    { state: "attached", timeout: 60_000 },
  );
  await page.getByTestId("copilotkit-v2-send").click();
  await thinkingAppeared;

  const messages = page.getByTestId("copilotkit-v2-messages");
  await expect(messages).toContainText(CHAT_READ_E2E.agentReplyPrefix, { timeout: 60_000 });

  // run 收场后进度行必须消失——留着会让"上一轮跑了多久"一直挂在界面上，读起来像还在跑。
  await expect(page.getByTestId("copilotkit-v2-thinking-elapsed")).toHaveCount(0, { timeout: 30_000 });

  // ── 反证① 复制：剪贴板里真的是这条 AI 消息的正文 ────────────────────────────
  const assistantBubble = page.getByTestId("copilot-assistant-message").last();
  await assistantBubble.hover();
  const copyButton = assistantBubble.getByTestId("chat-message-copy");
  await expect(copyButton).toHaveCount(1, { timeout: 20_000 });
  await copyButton.click();

  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText.trim()).not.toBe("");
  expect(clipboardText).toContain(CHAT_READ_E2E.agentReplyPrefix);

  // ── 反证② 评分：POST 真发出且服务端真的接受了（不是 404 的假入口）───────────
  const ratingButton = assistantBubble.getByTestId("chat-message-rating-up");
  // 按设计：解析不出真实落库 id 就不画这个按钮。它在这里出现，本身就是
  // `chat_message_id` 回显真的到达了的第一个证据。
  await expect(ratingButton).toHaveCount(1, { timeout: 30_000 });

  const ratingResponse = page.waitForResponse(
    (res) => /\/messages\/[^/]+\/rating$/.test(res.url()) && res.request().method() === "POST",
    { timeout: 30_000 },
  );
  await ratingButton.click();
  const res = await ratingResponse;

  // 这一行是本文件存在的主要理由：id 接错时这里就是 404，而 UI 上什么都看不出来。
  expect(res.status()).not.toBe(404);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { ratingId?: string };
  expect(typeof body.ratingId).toBe("string");

  // UI 侧的成功回执（服务端先答应了才显示，不做乐观更新——`message-rating.tsx` 纪律）。
  await expect(assistantBubble.getByTestId("chat-message-rating-done")).toBeVisible({ timeout: 20_000 });

  // ── 反证③ 反馈入口存在，且归因到真的选中的那个 agent ────────────────────────
  await expect(assistantBubble.getByTestId("chat-agent-feedback")).toHaveCount(1);
});

test("CK-P4 失败重试——横幅上的「重试」真的发起一次新 run，不是把错误状态擦掉", async ({ page }) => {
  await loginAndOpenChat(page);

  let runRequestCount = 0;
  page.on("request", (req) => {
    if (req.method() === "POST" && RUN_ROUTE.test(req.url())) runRequestCount += 1;
  });

  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentFailureTrigger);
  await page.getByTestId("copilotkit-v2-send").click();

  await expect(page.getByTestId("copilotkit-v2-error")).toHaveCount(1, { timeout: 60_000 });
  const countAfterFirstRun = runRequestCount;
  expect(countAfterFirstRun).toBeGreaterThan(0);

  const retry = page.getByTestId("copilotkit-v2-retry");
  await expect(retry).toBeVisible({ timeout: 20_000 });
  await retry.click();

  // ── 反证 wire 上真的多了一次 run 请求 ───────────────────────────────────────
  // 一个只把 `error` state 置 null 的假重试同样会让横幅消失，但计数不会涨。
  await expect
    .poll(() => runRequestCount, { timeout: 60_000, intervals: [500, 1_000, 2_000] })
    .toBeGreaterThan(countAfterFirstRun);

  // 重发的是**失败的那一句**（不是空串、不是 composer 当前草稿）：它在消息区出现两次。
  const userBubbles = page.getByTestId("copilotkit-v2-messages").getByText(
    CHAT_READ_E2E.deepAgentFailureTrigger,
    { exact: false },
  );
  await expect.poll(async () => userBubbles.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
});
