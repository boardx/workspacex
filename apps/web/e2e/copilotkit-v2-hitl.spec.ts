import { test, expect } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * issue #2774（2026-09-05，取代 DA-19d/DA-19g 时代的三条 approve/编辑/reject 用例）——
 * `/chat` 接入 F08 四选一工具权限卡（`ToolPermissionCard`），退役旧
 * `copilotkit-v2-approval-dialog.tsx`（`useHumanInTheLoop`）。
 *
 * ## 为什么整份重写，不是把旧测试的 testid 换一下
 *
 * 旧机制：CopilotKit `useHumanInTheLoop` 只注册了一个工具名（`APPROVAL_TOOL_NAME` =
 * `call_skill`），裁决走框架合成的 `respond()`，resume 靠 AG-UI follow-up `runAgent`
 * 请求路由回 `resumeAguiBridgeTurn`（`agui-bridge.ts`）。2026-09-05 devapp 实测：这条
 * 桥接链路又一次卡在只读分支、`respond` 未定义——旧机制对"该弹的时候能不能裁决"这件
 * 事本身是脆弱的（DA-19g 已经因为同一类桥接时序问题修过一次）。
 *
 * 新机制不依赖 AG-UI 逐工具调用桥接：`ChatHostToolPermission` 直接观察 F06 的
 * `awaiting_tool_permission` 状态（同一条 `useChatHostInterjectionRun` WS 订阅），裁决
 * 直接打 REST `POST /agent-runs/:runId/tool-calls/:toolCallId/decision`
 * （`decideToolPermission`）。resume 因此也换了一条路：不再有"第二次 `runAgent` POST"
 * 这件事——run 由后端 executor 的常规 tick 机制（`kick()`）继续执行，完成后的助手
 * 回复通过**消息列表**（`copilotkit-v2-messages` 的既有轮询/刷新路径）出现，不是通过
 * 第二轮 AG-UI SSE 帧。旧测试"至少两次 POST 落地"的 wire 级断言因此不再适用，改为直接
 * 断言 UI 上真正重要的事实：卡片出现→点决策→卡片收起→最终回复的文字真的出现。
 *
 * ## 三条用例与旧三条的对应关系
 *
 * 新决策是四选一（仅本次/本次 run 内/以后都允许/拒绝），没有"编辑参数"这个概念了
 * （F08 卡片没有编辑入口，契约 `ToolPermissionDecisionKind` 也没有 edit 分支）——
 * 旧"edit"用例因此没有直接对应物，这里换成"本次 run 内都允许"，覆盖一个旧用例组
 * 从未验证过的授权粒度（`run`/`forever` 与`once`对后端是三条不同的决策值，客户端有没有
 * 传对，此前只有单测覆盖过服务端一侧，没有真实浏览器验证过前端真的发对了值）。
 *
 * - 旧 approve → 新"仅本次允许"（perm-once）
 * - 旧 reject  → 新"拒绝"（perm-deny）——**行为也变了**：旧 reject 直接
 *   `failRun("HITL_REJECTED")`（run 终态失败）；新 deny 走 `denyAndRequeue`
 *   （R3 步骤 6：内核据此调整计划继续跑，不是直接失败）。回归替身
 *   `loopback-deep-agent-provider.ts` 补了一条独立分支覆盖这条此前"永远不会被观察到"
 *   的路径（见该文件头注 issue #2774 那一段）。
 * - 旧 edit    → 新"本次 run 内都允许"（perm-run，替代已不存在的编辑能力）
 */

test.setTimeout(120_000);

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
 * issue #2175 复核（同 `chat-read-fixture.ts` 系列既有教训）—— `sendDisabledReason`
 * 对"composer 为空"单独给一条禁用理由，与"是否还卡在 run 里"无关；直接读
 * `data-send-state` 才是"不再卡在运行中"这件事本身的信号。
 */
async function expectSendNotBlockedOnRun(
  page: import("@playwright/test").Page,
  timeoutMs = 30_000,
): Promise<void> {
  await expect
    .poll(() => page.getByTestId("copilotkit-v2-send").getAttribute("data-send-state"), { timeout: timeoutMs })
    .not.toBe("running");
}

async function triggerApproval(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);

  await warmUpCopilotRuntimeRoute(page);
  await page.goto("/chat");
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentApprovalTrigger);
  await page.getByTestId("copilotkit-v2-send").click();
}

test("仅本次允许：卡片真的渲染真实数据，点击后 run 真的继续执行完成", async ({ page }) => {
  await triggerApproval(page);

  const card = page.getByTestId("tool-permission-card");
  await expect(card).toBeVisible({ timeout: 30_000 });
  // 真实数据来自后端 `AgentRunView.pendingApproval.toolName`（issue #2017 教训同款：
  // 断言"卡片出现了"守不住工具名对不对，必须断言展示的内容里真的有那个工具名）——
  // 触发词走的是 `call_skill`（`DEEP_AGENT_HITL_TOOL_NAME`），见 `chat-host-tool-
  // permission.tsx` 的通用 intent 文案 `调用工具 ${toolName}`。
  await expect(page.getByTestId("perm-intent")).toContainText("call_skill");

  await page.getByTestId("perm-once").click();

  // 卡片随 run 状态离开 awaiting_tool_permission 自然收起——不是本组件自己乐观卸载。
  await expect(card).toHaveCount(0, { timeout: 30_000 });
  await expectSendNotBlockedOnRun(page);
  await expect(page.locator('[data-testid="copilotkit-v2-messages"]')).toContainText(
    "已按原参数执行", { timeout: 30_000 },
  );
});

test("本次 run 内都允许：客户端真的把 \"run\" 这个决策值发给后端，run 照常继续执行完成", async ({ page }) => {
  await triggerApproval(page);

  const card = page.getByTestId("tool-permission-card");
  await expect(card).toBeVisible({ timeout: 30_000 });

  const decisionRequest = page.waitForRequest(
    (req) => req.url().includes("/tool-calls/") && req.url().endsWith("/decision") && req.method() === "POST",
  );
  await page.getByTestId("perm-run").click();
  const request = await decisionRequest;
  expect(request.postDataJSON()).toEqual({ decision: "run" });

  await expect(card).toHaveCount(0, { timeout: 30_000 });
  await expectSendNotBlockedOnRun(page);
  await expect(page.locator('[data-testid="copilotkit-v2-messages"]')).toContainText(
    "已按原参数执行", { timeout: 30_000 },
  );
});

test("拒绝：run 不是直接失败，而是继续执行完成，最终回复真的反映\"已跳过\"（R3 步骤 6）", async ({ page }) => {
  await triggerApproval(page);

  const card = page.getByTestId("tool-permission-card");
  await expect(card).toBeVisible({ timeout: 30_000 });
  // 拒绝后原始命令/意图仍展示——同旧弹窗"拒绝后不清空上下文"的既有纪律，换了组件、
  // 纪律不变。
  const intentBefore = await page.getByTestId("perm-intent").textContent();

  await page.getByTestId("perm-deny").click();

  await expect(card).toHaveCount(0, { timeout: 30_000 });
  await expectSendNotBlockedOnRun(page);
  // 核心断言：run 真的以正常完成收场（不是 30s 超时也不是终态失败），且最终回复的
  // 文字真的反映"跳过了这次调用"，不是谎称"已执行技能"（loopback-deep-agent-
  // provider.ts 新补的 reject 独立分支，见该文件头注 issue #2774 那一段）。
  await expect(page.locator('[data-testid="copilotkit-v2-messages"]')).toContainText(
    "已按你的选择跳过这个技能调用", { timeout: 30_000 },
  );
  expect(intentBefore).toContain("call_skill");
});
