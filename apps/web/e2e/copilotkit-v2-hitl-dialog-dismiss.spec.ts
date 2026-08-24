import { test, expect } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * DA-19g（issue #1996）—— 真栈回归：`SendEmailApprovalDialog` 终态弹窗关闭后，
 * 模态遮罩必须真的从 DOM 移除，聊天面板必须仍能继续发新消息。
 *
 * ## 背景（如实记录本轮撞见的 bug，不是凭空写的假设）
 *
 * DA-19g 评分循环第一轮（`.harness/state/copilotkit-v2-ux-acceptance-score.md`
 * 判据 #10）在真实浏览器交互测试中发现：`copilotkit-v2-panel.tsx` 的
 * `SendEmailApprovalDialog` 在 HITL 终态只读分支（`!awaitingDecision` 分支）渲染
 * `<Dialog open>`——`open` 是硬编码字面量 `true`，从未接 `onOpenChange`，这个分支
 * 也没有任何关闭按钮。Radix `Dialog` 在这种情况下，右上角默认关闭图标 / Escape /
 * 点遮罩层外部这些交互都会触发事件，但没有状态可以翻转 `open`——遮罩
 * （`fixed inset-0 z-50 bg-inverse/40 backdrop-blur-sm ...`）因此永久留在页面上。
 * 由于承载这个组件的 `send_email` 工具调用消息永远留在 `agent.messages` 里，
 * 这个 Dialog 一旦挂载就永不卸载：真实操作证据是 Playwright 点"发送"按钮被这层
 * 遮罩拦截指针事件，连续重试 185 次、约 90 秒仍无法穿透，最终超时——用户能看到
 * 输入框和按钮，点了没反应，唯一解法是刷新页面。
 *
 * 修法（`copilotkit-v2-panel.tsx` `SendEmailApprovalDialog`）：两个渲染分支都改成
 * 真正受控的 `open`/`onOpenChange`，本地 `dismissed` state 落地为"不再挂载
 * Dialog"；只读终态分支补一个显式可见的"关闭"按钮
 * （`data-testid=copilotkit-v2-hitl-dismiss`），不再只依赖 Radix 默认右上角图标。
 *
 * ## 这条测试断言什么、不断言什么
 *
 * 不满足于"按钮 `enabled===true`"——那个属性在 bug 存在时也一直是 `true`
 * （`agent.isRunning` 早就落回 `false`），问题是有一层看不见但拦截点击的遮罩挡在
 * 上面。这里改用真实的 `page.route()` 网络拦截确认点击"发送"之后**真的发出了新
 * 请求**，这是唯一能证明"点击真的传导到了应用逻辑"的信号。
 *
 * 走的触发词是 `deepAgentApprovalTrigger`——已知后端缺口（DA-19d backlog）：
 * `send_email` 工具调用被过早标记为"已完成"，`respond` 从未变成非 `undefined`，
 * `SendEmailApprovalDialog` 落进 `!awaitingDecision` 只读分支——这正是本次要回归
 * 覆盖的那个分支，不是构造一个假场景。run 最终以 `AGENT_RUN_TIMEOUT`
 * （`runAguiBridgeTurn` maxPolls≈30s）收场，这是已知的、独立的后端缺口，本测试
 * 不重复断言它（`copilotkit-v2-hitl.spec.ts` 已经用 wire 级证据断言过），只是把它
 * 当作触达终态只读分支的必经之路，等它跑完再验证前端的关闭/继续交互。
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

test("DA-19g 回归：HITL 终态弹窗关闭后遮罩真的从 DOM 移除，发送按钮真的可点击且真的发出新请求", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);

  await warmUpCopilotRuntimeRoute(page);
  await page.goto("/chat/copilotkit-v2");

  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentApprovalTrigger);
  await page.getByTestId("copilotkit-v2-send").click();

  // 已知后端缺口（DA-19d）让这个工具调用几乎立刻落进只读终态分支——不需要等到
  // run 整体超时，`SendEmailApprovalDialog` 的只读分支（含"关闭"按钮）会先出现。
  const dismissButton = page.getByTestId("copilotkit-v2-hitl-dismiss");
  await expect(dismissButton).toBeVisible({ timeout: 60_000 });

  // 反证①：此刻真的存在一层 Radix Dialog 遮罩——不是在测一个从未出现过的假前提。
  await expect(page.locator(OVERLAY_SELECTOR).first()).toBeVisible();

  await dismissButton.click();

  // 核心断言①（本次修复的直接对象）：遮罩真的从 DOM 里被移除，不是只是视觉上
  // 淡出——bug 版本这里永远不会变成 0（`open` 是硬编码字面量，Radix 无状态可翻转）。
  await expect(page.locator(OVERLAY_SELECTOR)).toHaveCount(0);
  await expect(page.getByTestId("copilotkit-v2-hitl-dialog")).toHaveCount(0);

  // 等 run 整体收场（已知的独立后端缺口：AGENT_RUN_TIMEOUT，~30s），发送按钮才会
  // 重新变成可用态——这一步只是等待前置条件成立，不是本测试要验证的内容。
  await expect(page.getByTestId("copilotkit-v2-send")).toBeEnabled({ timeout: 90_000 });

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
