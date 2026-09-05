import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { DEEP_AGENT_HITL_TOOL_NAME } from "@repo/contracts/deep-agent-hitl";

/**
 * issue #2767 —— `/chat` 的 `call_skill` HITL 从旧 `SendEmailApprovalDialog`
 * （approve/编辑/reject 三态）换成 F08 签核的 `ToolPermissionCard`（仅本次允许/
 * 本 run 内都允许/以后都允许/拒绝 四选一），路由从旧 DA-07b `decideAgentRun` 换成
 * F06 `decideToolPermission`。本文件是这次替换的回归覆盖——DA-19g 那批真根因修复
 * （`writeToolCallStep` 的 `"in_progress"` 分支不再提前发空 `TOOL_CALL_RESULT`、
 * `resumeAguiBridgeTurn`/`resumeAguiBridgeTurnToolPermission` 把 `respond()` 之后的
 * follow-up 路由回被打断的 run）本身没有变，这里不重复它的历史记录（见 git 历史）。
 *
 * ## 为什么这个触发场景仍然会弹卡片——L0 skill 分级修复不是"call_skill 永不弹窗"
 *
 * issue #2767 的核心修复是"`call_skill` 的等级按目标 skill 判定"：pdf-create 这类
 * 平台官方 skill 是 L0，不再弹窗。本文件的 loopback 替身用的 `skill_stable_name:
 * "quarterly-report"` 从来不是一个真实挂载的 skill（这条 e2e 线程没有 mount 任何
 * skill），`domain/agent-run/skill-risk-level.ts` 的 `classifyToolCallRisk` 查不到
 * 它 ⇒ fail-closed 判 L2 ⇒ 仍然弹卡片——这正是本文件要覆盖的"真正需要确认时，四选一
 * 卡片确实工作"，与"L0 skill 不再弹"是同一个分级机制的两个反面，不冲突。
 */

const OUT = resolve(process.env.COPILOTKIT_V2_HITL_OUT ?? ".copilotkit-v2-hitl");
test.setTimeout(120_000);

interface AguiFrame { readonly type: string; readonly [key: string]: unknown }

function parseSseFrames(raw: string): AguiFrame[] {
  return raw
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith("data:"))
    .map((chunk) => JSON.parse(chunk.slice("data:".length).trim()) as AguiFrame);
}

// 与 `copilotkit-v2-runtime-adapter.spec.ts`/`copilotkit-v2-agent-context.spec.ts`
// 同一个已实测过的编译预热坑：Next dev 首次编译窗口撞上 `/info` 探测会让整个 agent
// 被标记 `runtime_info_fetch_failed`，永久失败。
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
 * issue #2175 复核 -- 不能直接断言 composer 的 `toBeEnabled()`：composer 在
 * `triggerApproval` 发过一次消息后已经清空，"输入为空"是 `sendDisabledReason` 独立
 * 给出的合法禁用理由，与"是不是还卡在 run 里"无关。改读 `data-send-state`（running/
 * disabled/ready）判"不再卡在运行中"这一条真正要验的信号。
 */
async function expectSendNotBlockedOnRun(
  page: import("@playwright/test").Page,
  timeoutMs = 30_000,
): Promise<void> {
  await expect
    .poll(() => page.getByTestId("copilotkit-v2-send").getAttribute("data-send-state"), { timeout: timeoutMs })
    .not.toBe("running");
}

/** Every test starts identically: log in, warm the runtime route, land on the v2 panel,
 * capture EVERY `POST /api/copilotkit/*` request's response body (both the turn that trips
 * the interrupt AND the resume turn `respond()` triggers), send the approval trigger, wait
 * for the card to mount. Returns the captured frame groups plus the page. */
async function triggerApproval(page: import("@playwright/test").Page): Promise<{ capturedBodies: Buffer[] }> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);

  const capturedBodies: Buffer[] = [];
  await page.route(
    (u) => u.pathname.endsWith("/agent/default/run"),
    async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      const fetched = await route.fetch();
      capturedBodies.push(await fetched.body());
      await route.fulfill({ response: fetched });
    },
  );

  await warmUpCopilotRuntimeRoute(page);
  await page.goto("/chat");
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentApprovalTrigger);
  await page.getByTestId("copilotkit-v2-send").click();

  return { capturedBodies };
}

test("issue #2767 once：四个决策按钮真的渲染，点击「仅本次允许」后 run 真的执行完成", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const { capturedBodies } = await triggerApproval(page);

  // ── 反证①：四个决策按钮真的渲染出来（DA-19g 的 respond 落在 executing 态这条
  // 修复没有跟着这次替换回归） ──
  const dialog = page.getByTestId("chat-tool-permission-dialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  const onceButton = page.getByTestId("perm-once");
  await expect(onceButton).toBeVisible();
  await expect(page.getByTestId("perm-run")).toBeVisible();
  await expect(page.getByTestId("perm-always")).toBeVisible();
  await expect(page.getByTestId("perm-deny")).toBeVisible();

  // ── issue #2017 的核心断言仍然成立：**线上真的发的那个工具名，就是契约里的那个** ──
  const toolCallNames = capturedBodies
    .flatMap((b) => parseSseFrames(b.toString("utf8")))
    .filter((f) => f.type === "TOOL_CALL_START")
    .map((f) => f["toolCallName"]);
  expect(toolCallNames, "事件流里没有任何 TOOL_CALL_START").not.toHaveLength(0);
  expect(toolCallNames).toContain(DEEP_AGENT_HITL_TOOL_NAME);

  // I-3：完整参数，不截断。
  const command = await page.getByTestId("perm-command").textContent();
  expect(command).toContain("quarterly-report");
  expect(command).toContain("原始参数，未编辑");

  await onceButton.click();

  // 对话框立刻卸载（respond() 前 close() 同步调用）——不是等 run 收尾才关。
  await expect(dialog).toHaveCount(0);

  await expectSendNotBlockedOnRun(page);
  await expect.poll(() => capturedBodies.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  await expect(page.locator('[data-testid="copilotkit-v2-messages"]')).toContainText(
    "已按原参数执行", { timeout: 30_000 },
  );

  writeFileSync(
    resolve(OUT, "hitl-once-wire-frames.json"),
    JSON.stringify(capturedBodies.map((b) => parseSseFrames(b.toString("utf8"))), null, 2),
    "utf8",
  );

  // wire 级反证：至少两次 POST（第一轮触发中断 + resume），且没有任何一次带 RUN_ERROR
  // ——F06 once/run/forever 都走 `approveAndRequeue` 这同一条边，不是失败终态。
  expect(capturedBodies.length).toBeGreaterThanOrEqual(2);
  const allFrames = capturedBodies.flatMap((b) => parseSseFrames(b.toString("utf8")));
  expect(allFrames.some((f) => f.type === "RUN_ERROR")).toBe(false);
  const firstTurnFrames = parseSseFrames(capturedBodies[0]!.toString("utf8"));
  expect(firstTurnFrames.some((f) => f.type === "TOOL_CALL_END")).toBe(true);
  expect(firstTurnFrames.some((f) => f.type === "TOOL_CALL_RESULT")).toBe(false);
});

test("issue #2767 forever：respond 发的是契约字面量 forever，不是卡片文案 always", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const { capturedBodies } = await triggerApproval(page);

  const alwaysButton = page.getByTestId("perm-always");
  await expect(alwaysButton).toBeVisible({ timeout: 30_000 });
  await alwaysButton.click();

  await expect(page.getByTestId("chat-tool-permission-dialog")).toHaveCount(0);
  await expectSendNotBlockedOnRun(page);
  await expect.poll(() => capturedBodies.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);

  // resume 请求体里的 tool 消息 content 必须是契约字面量 "forever"（`ToolPermissionCard`
  // 的 "always" 只是文案层命名，`chat-host-tool-permission.tsx` 负责翻译，见其文档）。
  const secondTurnBody = JSON.parse(capturedBodies[1]!.toString("utf8")) as {
    messages?: readonly { role: string; content?: string }[];
  };
  const toolMessage = [...(secondTurnBody.messages ?? [])].reverse().find((m) => m.role === "tool");
  expect(toolMessage?.content).toBe("forever");

  await expect(page.locator('[data-testid="copilotkit-v2-messages"]')).toContainText(
    "已按原参数执行", { timeout: 30_000 },
  );
});

test("issue #2767 deny：run 不失败，agent 据此调整继续跑（不是旧三态的 HITL_REJECTED 硬失败）", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const { capturedBodies } = await triggerApproval(page);

  const denyButton = page.getByTestId("perm-deny");
  await expect(denyButton).toBeVisible({ timeout: 30_000 });
  await denyButton.click();

  await expect(page.getByTestId("chat-tool-permission-dialog")).toHaveCount(0);
  await expectSendNotBlockedOnRun(page);
  await expect.poll(() => capturedBodies.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);

  writeFileSync(
    resolve(OUT, "hitl-deny-wire-frames.json"),
    JSON.stringify(capturedBodies.map((b) => parseSseFrames(b.toString("utf8"))), null, 2),
    "utf8",
  );

  // 核心断言：F06 的 deny 不是旧 DA-07b 的 reject——run 不会以 RUN_ERROR/HITL_REJECTED
  // 收场，而是继续跑完，最终答案里能看到 loopback 替身对"被拒绝"给出的诚实回应
  // （`loopback-deep-agent-provider.ts` 对 `decision.type === "reject"` 的专门分支，
  // 见该文件同一处的 issue #2767 头注）。
  const allFrames = capturedBodies.flatMap((b) => parseSseFrames(b.toString("utf8")));
  expect(allFrames.some((f) => f.type === "RUN_ERROR"), JSON.stringify(allFrames)).toBe(false);
  await expect(page.locator('[data-testid="copilotkit-v2-messages"]')).toContainText(
    "已按你的选择跳过这次技能调用", { timeout: 30_000 },
  );
});
