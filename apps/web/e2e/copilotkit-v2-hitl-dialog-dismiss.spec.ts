import { test, expect } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * DA-19g（issue #1996, revised by the DA-19g HITL approval-semantics task）—— 真栈
 * 回归：`SendEmailApprovalDialog` 关闭后，模态遮罩必须真的从 DOM 移除，聊天面板必须
 * 仍能继续发新消息。
 *
 * ## 背景（原始 bug，PR #1996 修的那部分——仍然是这个组件的真实前端行为）
 *
 * `SendEmailApprovalDialog` 曾经在只读分支渲染 `<Dialog open>`——`open` 是硬编码字面
 * 量 `true`，从未接 `onOpenChange`，没有任何关闭按钮。Radix 因此没有状态可以翻转，
 * 遮罩永久留在页面上，`send_email` 工具调用消息又永远留在 `agent.messages` 里，一旦
 * 挂载就永不卸载。修法：两个渲染分支都改成真正受控的 `open`/`onOpenChange`，`dismissed`
 * state 落地为"不再挂载 Dialog"。
 *
 * ## 本文件为什么改写（不是重新发明这条回归覆盖，是它的必经路径变了）
 *
 * 这条测试原本靠 DA-19d 遗留的后端缺口（`writeToolCallStep` 把待批步骤当已完成处理）
 * 把 `deepAgentApprovalTrigger` 场景"顺路"送进只读终态分支——那是 DA-19g HITL 审批
 * 语义任务要修掉的 BUG 本身，继续依赖它就是继续断言一个不该存在的行为。审批语义修好
 * 后，这个 trigger 正常会进入 `"executing"` 交互分支（approve/编辑/reject 三个按钮
 * 真的渲染出来，见 `copilotkit-v2-hitl.spec.ts`），不再自动落到只读分支。
 *
 * 这条测试因此改测同一个真实前端行为的另一个入口：交互分支里 Escape/点遮罩层外部
 * 触发 `onOpenChange(false)` 时，组件把它当"拒绝"处理（`respond("denied")` +
 * `close()`，见该组件自己的注释）——这仍然是原 bug 修复覆盖的同一段"关闭必须真的把
 * 遮罩从 DOM 移除"逻辑，只是从"自动到达的只读终态"换成"用户主动 Escape 退出"这个同样
 * 真实、且审批语义修好后仍然存在的路径。
 */

test.setTimeout(150_000);

const OVERLAY_SELECTOR = '[data-state="open"][aria-hidden="true"].fixed.inset-0.z-50';

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

test("DA-19g 回归：HITL 对话框 Escape 退出后遮罩真的从 DOM 移除，发送按钮真的可点击且真的发出新请求", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);

  await warmUpCopilotRuntimeRoute(page);
  await page.goto("/chat/copilotkit-v2");

  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentApprovalTrigger);
  await page.getByTestId("copilotkit-v2-send").click();

  // 审批语义修好后，这个 trigger 正常到达交互分支（approve/编辑/reject 三个按钮）——
  // `copilotkit-v2-hitl.spec.ts` 断言这三个按钮本身；这里只用它们的出现确认对话框
  // 真的挂载了，然后走 Escape 退出这条路径。
  const approveButton = page.getByTestId("copilotkit-v2-hitl-approve");
  await expect(approveButton).toBeVisible({ timeout: 60_000 });

  // 反证①：此刻真的存在一层 Radix Dialog 遮罩——不是在测一个从未出现过的假前提。
  await expect(page.locator(OVERLAY_SELECTOR).first()).toBeVisible();

  await page.keyboard.press("Escape");

  // 核心断言①（本次修复的直接对象）：遮罩真的从 DOM 里被移除，不是只是视觉上
  // 淡出——bug 版本这里永远不会变成 0（`open` 是硬编码字面量，Radix 无状态可翻转）。
  await expect(page.locator(OVERLAY_SELECTOR)).toHaveCount(0);
  await expect(page.getByTestId("copilotkit-v2-hitl-dialog")).toHaveCount(0);

  // Escape 等价于拒绝（`onOpenChange(false)` → `respond("denied")`）——run 应该很快
  // 以 `HITL_REJECTED` 收场（不是本次改动之前那种 ~30s 的 `AGENT_RUN_TIMEOUT`），
  // 发送按钮随之重新可用。
  await expect(page.getByTestId("copilotkit-v2-send")).toBeEnabled({ timeout: 30_000 });

  // 核心断言②（真正的回归点）：发一条无关的简单消息，点击"发送"之后必须真的有
  // 新的 POST 打到 CopilotRuntime——不是只看按钮的 `enabled` 属性（那个在 bug 存在
  // 时也一直是 `true`）。
  let sawNewRuntimeRequest = false;
  await page.route(
    (u) => u.pathname.includes("/api/copilotkit/") && u.pathname !== "/api/copilotkit/info",
    async (route) => {
      if (route.request().method() === "POST") sawNewRuntimeRequest = true;
      await route.continue();
    },
  );

  await page.getByTestId("copilotkit-v2-input").fill("你好，这是一条简单的问候消息");
  await page.getByTestId("copilotkit-v2-send").click({ timeout: 10_000 });

  await expect.poll(() => sawNewRuntimeRequest, { timeout: 20_000 }).toBe(true);

  await page.unroute("**/api/copilotkit/**");
});
