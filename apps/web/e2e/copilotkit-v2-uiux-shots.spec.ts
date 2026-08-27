import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * issue #2039 —— `/chat/copilotkit-v2` UIUX 三轮迭代的**取证截图 spec**。
 *
 * 它不是功能断言 spec（功能各有专属 spec），职责是把这块屏的关键视觉状态在真栈、
 * 真登录下抓成 PNG 落进 `.copilotkit-v2-uiux/`，供：
 *   ① 每轮迭代的前后对比留档（同一支 spec、同一批状态、同一组文件名，跑两次 diff 图）；
 *   ② 后续 rev-uiux / fidelity 流程复核时有真栈截图可看，不用只读代码打分。
 *
 * 断言刻意最小化（元素存在 + 无横向溢出），不断言像素——像素对比由人看图完成，
 * 机器断言只守住「截图里真的有内容」（H1 反空转）与「375px 不横向溢出」（U8）。
 */

const OUT = resolve(process.env.COPILOTKIT_V2_UIUX_OUT ?? ".copilotkit-v2-uiux");

test.setTimeout(180_000);

/**
 * issue #2247 —— 与 #2201（Closes #2175）诊断的四项同一根因，本文件此前未被那轮扫到
 * 的第 5 个实例。`isDisabled()===false` 隐含"没有别的原因会让按钮 disabled"这条假设，
 * 在 issue #2130（TW-P0-5④，`49cda935`）之后不再成立：composer 在 `send()` 成功清空后
 * 只剩"输入为空"这条独立、合法的禁用理由（`copilotkit-v2-panel.tsx` 的
 * `sendDisabledReason`），下面两条断言点上 composer 恰好都已被清空——原判据因此永远
 * 等不到 `false`，60s/90s 超时后稳定红，与流式渲染/多步执行本身是否健康无关。
 *
 * 换成读 `title` 是否还等于"运行中"这条禁用理由（与"输入为空"独立理由分开判断），
 * 与 `copilotkit-v2-stream-frame-timing.spec.ts` 的 `expectSendNotBlockedOnRun`
 * 逐字同一套写法，不是发明第二份判据。
 */
const RUNNING_DISABLED_REASON = "Agent 正在处理上一条消息，请稍候…";
async function expectSendNotBlockedOnRun(page: Page, timeoutMs = 30_000): Promise<void> {
  await expect
    .poll(() => page.getByTestId("copilotkit-v2-send").getAttribute("title"), { timeout: timeoutMs })
    .not.toBe(RUNNING_DISABLED_REASON);
}

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);
  await expect
    .poll(
      async () => (await page.request.get("/api/copilotkit/info")).status(),
      { timeout: 60_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(200);
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `horizontal overflow of ${overflow}px at ${page.viewportSize()?.width}px`).toBeLessThanOrEqual(0);
}

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
});

test("空态 + 移动端宽度：桌面/375px 两档截图，375 不横向溢出", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/chat");
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible();
  // 让线程列表/agent 目录读完再抓（空态或列表都算稳态；这里等 toolbar 出现即可）。
  await expect(page.getByTestId("copilotkit-v2-agent-toolbar")).toBeVisible();
  await page.waitForTimeout(1_000);
  await page.screenshot({ path: resolve(OUT, "empty-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(OUT, "empty-mobile-375.png"), fullPage: true });
  await noHorizontalOverflow(page);
});

test("多轮对话 + markdown 回复 + 追问建议：桌面截图", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/chat");
  const input = page.getByTestId("copilotkit-v2-input");
  await input.fill("你好，请介绍一下你自己");
  await page.getByTestId("copilotkit-v2-send").click();
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText("你好，请介绍一下你自己", { timeout: 30_000 });
  await expectSendNotBlockedOnRun(page, 60_000);
  await input.fill(CHAT_READ_E2E.deepAgentMarkdownTrigger);
  await page.getByTestId("copilotkit-v2-send").click();
  await expectSendNotBlockedOnRun(page, 60_000);
  await page.waitForTimeout(1_000);
  await page.screenshot({ path: resolve(OUT, "conversation-markdown.png"), fullPage: true });
});

test("工具调用卡（多步剧本）：桌面截图", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/chat");
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentMultiStepTrigger);
  await page.getByTestId("copilotkit-v2-send").click();
  await expectSendNotBlockedOnRun(page, 90_000);
  await page.waitForTimeout(1_000);
  await page.screenshot({ path: resolve(OUT, "tool-cards.png"), fullPage: true });
});

test("错误横幅：真实失败链路下的视觉层级截图", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/chat");
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentFailureTrigger);
  await page.getByTestId("copilotkit-v2-send").click();
  await expect(page.getByTestId("copilotkit-v2-error")).toHaveCount(1, { timeout: 60_000 });
  await page.screenshot({ path: resolve(OUT, "error-banner.png"), fullPage: true });
});

test("HITL 审批弹窗：等待裁决态截图", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/chat");
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentApprovalTrigger);
  await page.getByTestId("copilotkit-v2-send").click();
  const dialog = page.getByTestId("copilotkit-v2-hitl-dialog");
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => await dialog.getAttribute("data-hitl-status"), { timeout: 60_000 })
    .toBe("executing");
  await page.screenshot({ path: resolve(OUT, "hitl-dialog.png"), fullPage: true });
  // 收尾：拒绝，让 run 干净结束，不留挂起的审批。
  await page.getByTestId("copilotkit-v2-hitl-reject").click();
});
