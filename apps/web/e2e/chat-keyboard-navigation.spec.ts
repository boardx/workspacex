/**
 * F05 —— chat 核心任务全键盘可达（`03-keyboard-accessibility.md#R3`）。
 *
 * 只验两条核心任务，逐字对齐 issue #1869 的 user_visible_behavior：
 *   1. 只用键盘发一条消息（Tab 走查真的能从会话卡到达消息输入框，Enter 发送）。
 *   2. 只用键盘切换到另一个会话（Tab/focus 到目标会话卡，Enter 选中）。
 *
 * 全程不调用 `page.mouse`，也不对任何按钮/卡片用 `.click()`——用 `locator.focus()`
 * （JS 层 `element.focus()`，不是鼠标事件）把光标带到起点，之后全部靠
 * `page.keyboard.press`/`page.keyboard.type` 推进。登录表单是测试前置条件，不是本
 * feature 要证的核心任务，`.fill()`/`.click()` 沿用仓库既有登录样板（同
 * `chat-read.spec.ts`），不在"只用键盘"范围内。
 *
 * 用的是 `keyboardThreadAId`/`keyboardThreadBId` 两条 F05 专属线程（`chat-read-
 * fixture.ts` 头注）：独立于共享的 51 条消息线程、也独立于 #1324 三条专属线程，
 * 不会互相污染断言。两条线程都种在 `restructureProjectId`（不是 `projectId`）——
 * `chat-read.spec.ts:41` 断言 `projectId` 下恰好一条会话，塞进去会顶掉那个数字。
 *
 * ## issue #2997 —— 锚点迁到 v2 工作台，验的核心任务逐字未变
 *
 * `#2890`（`d30ac48e8`）之后 `/chat?projectId=` 深链渲染的是 CopilotKit v2 工作台，
 * 旧屏（`chat-live-message-panel.tsx`）已无可达路由。本文件因此把两处旧屏锚点换成
 * v2 的对等物，**要证的两条核心任务、以及「不许抄近路直接 focus 输入框」这条纪律
 * 一字未动**：
 *   · `chat-message-input`  → `copilotkit-v2-input`（`copilotkit-v2-panel-body.tsx:1817`
 *     的 `<textarea>`，同样是 composer 的唯一文本载体、同样 Enter 发送 /
 *     Shift+Enter 换行，见该处 `onKeyDown`）
 *   · `chat-message-list`   → `copilotkit-v2-messages`（`copilotkit-v2-panel-body.tsx:1484`
 *     的消息滚动容器，同样是「已发出的消息真的出现在消息区」的唯一容器锚点）
 * 会话卡本身（`chat-thread-<id>`、`aria-current="page"`）是 `thread-list-shell.tsx`
 * 的共用组件，两屏同一份实现，无需改动。
 *
 * ⚠ 第二条用例的 URL 判据从 `?thread=<id>` 改成路径段 `/chat/<id>`：v2 选中线程走
 * `router.push(workbenchThreadPath(id, projectId))`（`lib/chat-workbench/project-scope.ts`），
 * 产出 `/chat/<id>?projectId=<pid>`。这是被测实现真实的导航形态变化，不是把判据放宽——
 * 「切换真的落到了地址栏」这件事仍然被钉住，且 `projectId` 作用域也一并断言没丢。
 */
import { expect, test } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { V2_SEND_WIRE } from "./chat-v2-send";

async function loginByKeyboard(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

test.describe("keyboard chat：chat 核心任务全键盘可达", () => {
  test("keyboard chat：只用键盘发一条消息", async ({ page }) => {
    await loginByKeyboard(page);

    await page.goto(
      `/chat?projectId=${CHAT_READ_E2E.restructureProjectId}&thread=${CHAT_READ_E2E.keyboardThreadAId}`,
    );
    await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.keyboardThreadAId}`)).toBeVisible();

    // 起点：把焦点带到当前选中的会话卡（不是鼠标点击，是把光标"放"在 Tab 走查的
    // 已知起点上）。真正要验证的是从这里开始按 Tab 能不能到达消息输入框，这正是
    // R3 的「Tab 顺序符合视觉顺序」要求——不是直接 `.focus()` 输入框抄近路。
    await page.getByTestId(`chat-thread-${CHAT_READ_E2E.keyboardThreadAId}`).focus();

    let reachedComposer = false;
    for (let step = 0; step < 40; step += 1) {
      await page.keyboard.press("Tab");
      const activeTestId = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);
      if (activeTestId === "copilotkit-v2-input") {
        reachedComposer = true;
        break;
      }
    }
    expect(reachedComposer, "从会话卡开始，Tab 走查应在有限步数内到达消息输入框（copilotkit-v2-input）").toBe(true);
    await expect(page.getByTestId("copilotkit-v2-input")).toBeFocused();

    const messageText = "Keyboard-only durable message";
    await page.keyboard.type(messageText);

    // issue #2997 —— v2 的发送线路是 `POST /api/copilotkit/agent/:id/run`，不是旧屏
    // 那条 `POST /chat/threads/:id/messages`（实测取证见 `chat-v2-send.ts` 头注）。
    // 断言的事没变：**只按 Enter** 真的把这一轮发了出去，且发的是刚敲的那句。
    const requestPromise = page.waitForRequest(
      (r) => r.method() === "POST" && V2_SEND_WIRE.test(new URL(r.url()).pathname),
      { timeout: 60_000 },
    );
    // Enter 发送（Shift+Enter 换行，`copilotkit-v2-panel-body.tsx` 的 `onKeyDown`）——不点「发送」按钮。
    await page.keyboard.press("Enter");
    const runRequest = await requestPromise;
    expect(JSON.stringify(runRequest.postDataJSON())).toContain(messageText);

    await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(messageText);
    // 消息发出去之后焦点不应该丢到 <body> 或不可见元素上——composer 本身仍是可继续输入的焦点载体。
    const activeAfterSend = await page.evaluate(() => document.activeElement?.tagName ?? null);
    expect(activeAfterSend, "发送后焦点不应丢失到 body/不可见元素").not.toBe("BODY");
  });

  test("keyboard chat：只用键盘切换到另一个会话", async ({ page }) => {
    await loginByKeyboard(page);

    await page.goto(
      `/chat?projectId=${CHAT_READ_E2E.restructureProjectId}&thread=${CHAT_READ_E2E.keyboardThreadAId}`,
    );
    await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.keyboardThreadAId}`)).toHaveAttribute("aria-current", "page");

    // 焦点起点放在当前会话卡，走查到目标会话卡，Enter 选中——不点鼠标。
    //
    // 会话列表按 `last_activity_at DESC` 排序，种子脚本插入顺序决定了
    // `keyboardThreadBId` 比 `keyboardThreadAId` 更晚创建、时间戳更新——因此
    // **在 DOM 里排在 A 前面**（实测确认：错误快照里顺序是 B、A、其余七条专属线程）。
    // 两个方向都试（先 Tab 后 Shift+Tab），不硬编码方向——种子脚本的插入顺序是实现
    // 细节，测试不应该因为将来调整种子顺序就被绑死。
    async function walkToTargetCard(key: "Tab" | "Shift+Tab"): Promise<boolean> {
      await page.getByTestId(`chat-thread-${CHAT_READ_E2E.keyboardThreadAId}`).focus();
      for (let step = 0; step < 20; step += 1) {
        await page.keyboard.press(key);
        const activeTestId = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);
        if (activeTestId === `chat-thread-${CHAT_READ_E2E.keyboardThreadBId}`) return true;
      }
      return false;
    }
    const reachedTargetCard = (await walkToTargetCard("Tab")) || (await walkToTargetCard("Shift+Tab"));
    expect(reachedTargetCard, "Tab/Shift+Tab 走查应能从当前会话卡到达目标会话卡（keyboardThreadBId）").toBe(true);

    await page.keyboard.press("Enter");

    // v2 的线程选中走路径段（见文件头注最后一段）：`/chat/<B>?projectId=<pid>`。
    // 两段都断言：换了线程 **且** 项目作用域没有在导航里被丢掉。
    await expect(page).toHaveURL(new RegExp(`/chat/${CHAT_READ_E2E.keyboardThreadBId}`));
    await expect(page).toHaveURL(new RegExp(`projectId=${CHAT_READ_E2E.restructureProjectId}`));
    await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.keyboardThreadBId}`)).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.keyboardThreadAId}`)).not.toHaveAttribute("aria-current", "page");
    // 切换后的会话详情真的加载了（不是只换了高亮态）：composer 仍可达、可继续操作。
    await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible();
  });
});
