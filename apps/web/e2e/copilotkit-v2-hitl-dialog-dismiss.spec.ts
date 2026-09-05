import { test, expect } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * DA-19g（issue #1996）的回归覆盖，issue #2767 起改测新宿主 `chat-host-tool-
 * permission.tsx`（`ChatHostToolPermission`）——旧 `SendEmailApprovalDialog` 已退役
 * （见该文件与 `copilotkit-v2-panel.tsx` 头注的完整历史）。
 *
 * 原始 bug（PR #1996）：`SendEmailApprovalDialog` 曾经在只读分支渲染 `<Dialog open>`
 * ——`open` 是硬编码字面量 `true`，从未接 `onOpenChange`，遮罩永久留在页面上。新宿主
 * 从一开始就是受控 `open={!dismissed}`，且非 `"executing"` 态直接 `return null`（不
 * 存在"只读分支"这个概念了）——本文件测的是同一段"关闭必须真的把遮罩从 DOM 移除"
 * 逻辑在新实现下的等价路径：交互态下 Escape/点遮罩层触发 `onOpenChange(false)`，
 * `chat-host-tool-permission.tsx` 把它当 F06 的 `deny` 处理（`respond("deny")` +
 * `close()`）。
 */

test.setTimeout(150_000);

const OVERLAY_SELECTOR = '[data-state="open"][aria-hidden="true"].fixed.inset-0.z-50';

// issue #2033 —— route/unroute 必须用同一个函数引用（字符串 pattern 卸不掉函数
// matcher）。本 spec 的处理器只 continue()，留下无害，但保持对称避免被复制成
// runtime-adapter/tool-rendering 那种 `route.fetch: Test ended` 泄漏。
const runRouteMatcher = (u: URL): boolean =>
  u.pathname.includes("/api/copilotkit/") && u.pathname !== "/api/copilotkit/info";

// 与 `copilotkit-v2-hitl.spec.ts`/`copilotkit-v2-runtime-adapter.spec.ts`/
// `copilotkit-v2-agent-context.spec.ts` 同一个已实测过的编译预热坑：Next dev 首次
// 编译窗口撞上 `/info` 探测会让整个 agent 被标记 `runtime_info_fetch_failed`，永久失败。
async function warmUpCopilotRuntimeRoute(page: import("@playwright/test").Page): Promise<void> {
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

/**
 * issue #2175 复核 —— `toBeEnabled()` 隐含"没有别的原因会让按钮 disabled"这条假设不
 * 成立：composer 在 approval trigger 发出后已清空，"输入为空"是 `sendDisabledReason`
 * 独立给出的合法禁用理由，与"是否还卡在 run 里"无关。这里只判"不再卡在 run"这条真正
 * 要验的信号。
 */
async function expectSendNotBlockedOnRun(
  page: import("@playwright/test").Page,
  timeoutMs = 30_000,
): Promise<void> {
  await expect
    .poll(() => page.getByTestId("copilotkit-v2-send").getAttribute("data-send-state"), { timeout: timeoutMs })
    .not.toBe("running");
}

test("issue #2767 回归：工具权限对话框 Escape 退出后遮罩真的从 DOM 移除，发送按钮真的可点击且真的发出新请求", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);

  await warmUpCopilotRuntimeRoute(page);
  await page.goto("/chat");

  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentApprovalTrigger);
  await page.getByTestId("copilotkit-v2-send").click();

  // `copilotkit-v2-hitl.spec.ts` 断言四个决策按钮本身；这里只用它们的出现确认对话框
  // 真的挂载了，然后走 Escape 退出这条路径。
  const dialog = page.getByTestId("chat-tool-permission-dialog");
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("perm-once")).toBeVisible();

  // 反证①：此刻真的存在一层 Radix Dialog 遮罩——不是在测一个从未出现过的假前提。
  await expect(page.locator(OVERLAY_SELECTOR).first()).toBeVisible();

  await page.keyboard.press("Escape");

  // 核心断言①：遮罩真的从 DOM 里被移除，不是只是视觉上淡出。
  await expect(page.locator(OVERLAY_SELECTOR)).toHaveCount(0);
  await expect(dialog).toHaveCount(0);

  // Escape 等价于 F06 的 deny（`onOpenChange(false)` → `respond("deny")`）——run 不会
  // 硬失败（F06 的 deny 与旧 reject 语义不同，见 `copilotkit-v2-hitl.spec.ts` 的 deny
  // 测试），发送按钮很快重新可用。
  await expectSendNotBlockedOnRun(page);

  // 核心断言②（真正的回归点）：发一条无关的简单消息，点击"发送"之后必须真的有
  // 新的 POST 打到 CopilotRuntime——不是只看按钮的 `enabled` 属性。
  let sawNewRuntimeRequest = false;
  await page.route(runRouteMatcher, async (route) => {
    if (route.request().method() === "POST") sawNewRuntimeRequest = true;
    await route.continue();
  });

  await page.getByTestId("copilotkit-v2-input").fill("你好，这是一条简单的问候消息");
  await page.getByTestId("copilotkit-v2-send").click({ timeout: 10_000 });

  await expect.poll(() => sawNewRuntimeRequest, { timeout: 20_000 }).toBe(true);

  await page.unroute(runRouteMatcher);
});
