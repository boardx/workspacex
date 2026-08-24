import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * DA-19g HITL 审批语义（issue #1987 起点，最终修复登记在 DA-19g HITL 审批语义任务）
 * —— 真实浏览器 + 真实 deep-agent loopback 替身，走 `/chat/copilotkit-v2` 触发
 * `deepAgentApprovalTrigger`（`CHAT_READ_E2E.deepAgentApprovalTrigger`），断言
 * `useHumanInTheLoop` 注册的 `send_email` 审批对话框的 approve/编辑/reject 三条路径
 * 真的渲染、真的生效。
 *
 * ## 这条测试曾经断言的坏行为，与它为什么被替换（如实记录，不是凭空重写）
 *
 * 这份文件的第一版（DA-19d 实测）证明了 AG-UI/CopilotRuntime 桥接层从未实现过审批
 * 语义：`copilotkit-agui.controller.ts` 的 `writeToolCallStep` 把一个还没被裁决的
 * `"in_progress"` 步骤当成已成功处理，立刻补发一个空 `TOOL_CALL_RESULT`——
 * `useHumanInTheLoop` 借以判定"还在等人"的信号从未成立，`respond` 全程 `undefined`，
 * `SendEmailApprovalDialog` 只能渲染只读分支，且 run 整体在 `awaiting_approval` 卡到
 * `runAguiBridgeTurn` 的 `maxPolls`（~30s）耗尽，以 `RUN_ERROR AGENT_RUN_TIMEOUT`
 * 收场。
 *
 * 那正是 DA-19g HITL 审批语义任务要修的 bug 本身——`writeToolCallStep` 现在对
 * `"in_progress"` 步骤只发 `STEP_STARTED`→`TOOL_CALL_START/ARGS/END`，不再提前发
 * `RESULT`/`STEP_FINISHED`；`runAguiBridgeTurn` 认识 `awaiting_approval` 这个中间态，
 * 不再把它当"还在跑"继续轮询到超时，而是让这一轮 SSE 以真实的 `RUN_FINISHED`
 * （不是 `RUN_ERROR`）收场，与一次真正的 AG-UI 前端工具调用同一个协议约定；
 * `resumeAguiBridgeTurn`（新增）把 `useHumanInTheLoop` 的 `respond()` 之后框架发起
 * 的 follow-up `runAgent` 请求路由回同一个被打断的 run，复用 DA-07b 的
 * `decideAgentRun`（旧 REST `/agent-runs/:runId/decision` 路径的同一套底层机制，不是
 * 重新发明一套）去 resume 它。下面三个测试断言的是修好之后的真实行为：真实点击
 * approve/编辑/reject 三个按钮，run 真的继续执行完成（不是卡在 30s 超时），编辑后的
 * 参数值真的生效。
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

/** Every test starts identically: log in, warm the runtime route, land on the v2 panel,
 * capture EVERY `POST /api/copilotkit/*` request's response body (both the turn that trips
 * the interrupt AND the resume turn `respond()` triggers), send the approval trigger, wait
 * for the interactive dialog to mount. Returns the captured frame groups plus the page. */
async function triggerApproval(page: import("@playwright/test").Page): Promise<{ capturedBodies: Buffer[] }> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);

  const capturedBodies: Buffer[] = [];
  // DA-19g -- only the actual `runAgent()` turn/resume traffic, not
  // `/api/copilotkit/agent/default/suggest` (DA-19e follow-up suggestions) or
  // `/api/copilotkit/threads` -- intercepting those too left an un-awaited
  // `route.fetch()` still in flight when the test ended (real failure this task's own
  // verification hit: "route.fetch: Test ended", reported against an unrelated background
  // suggestion request, not this test's own HITL assertions).
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
  await page.goto("/chat/copilotkit-v2");
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentApprovalTrigger);
  await page.getByTestId("copilotkit-v2-send").click();

  return { capturedBodies };
}

test("DA-19g approve：三个交互按钮真的渲染，点击「批准并继续」后 run 真的执行完成（不是卡在 30s 超时）", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const { capturedBodies } = await triggerApproval(page);

  // ── 反证①：approve/编辑/reject 三个按钮真的渲染出来（`respond` 真的落在
  // `"executing"`，不再是过早到达的空 RESULT 把它锁死在 `"complete"`） ──
  const approveButton = page.getByTestId("copilotkit-v2-hitl-approve");
  const startEditButton = page.getByTestId("copilotkit-v2-hitl-start-edit");
  const rejectButton = page.getByTestId("copilotkit-v2-hitl-reject");
  await expect(approveButton).toBeVisible({ timeout: 30_000 });
  await expect(startEditButton).toBeVisible();
  await expect(rejectButton).toBeVisible();

  const args = await page.getByTestId("copilotkit-v2-hitl-args").textContent();
  expect(args).toContain("ops@example.test");
  expect(args).toContain("原始正文（未编辑）");

  await approveButton.click();

  // 对话框立刻卸载（`close()` 在 `respond()` 之前同步调用）——不是等 run 收尾才关。
  await expect(page.getByTestId("copilotkit-v2-hitl-dialog")).toHaveCount(0);

  // ── 反证②：run 真的继续执行完成，最终答案里能看到「已按原参数发送」——不是卡在
  // `awaiting_approval` 直到 30s 超时收场（旧行为：`RUN_ERROR AGENT_RUN_TIMEOUT`） ──
  // `agent.isRunning` (this button's `disabled`) already flips back to `false` the moment
  // TURN ONE's `RUN_FINISHED` lands, BEFORE the human decides anything -- see
  // `copilotkit-v2-hitl.spec.ts`'s reject test for the full explanation. Waiting on the
  // actual network-level fact (a second `POST` having round-tripped) is what really proves
  // the resume happened, before asserting on its rendered content.
  await expect(page.getByTestId("copilotkit-v2-send")).toBeEnabled({ timeout: 30_000 });
  await expect.poll(() => capturedBodies.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  await expect(page.locator('[data-testid="copilotkit-v2-messages"]')).toContainText(
    "已按原参数发送", { timeout: 30_000 },
  );

  writeFileSync(
    resolve(OUT, "hitl-approve-wire-frames.json"),
    JSON.stringify(capturedBodies.map((b) => parseSseFrames(b.toString("utf8"))), null, 2),
    "utf8",
  );

  // wire 级反证：至少两次 POST（第一轮触发中断 + resume），且没有任何一次带 RUN_ERROR。
  expect(capturedBodies.length).toBeGreaterThanOrEqual(2);
  const allFrames = capturedBodies.flatMap((b) => parseSseFrames(b.toString("utf8")));
  expect(allFrames.some((f) => f.type === "RUN_ERROR")).toBe(false);
  // 第一轮：TOOL_CALL_END 后没有紧跟着的空 TOOL_CALL_RESULT——DA-19g 修复的核心信号。
  const firstTurnFrames = parseSseFrames(capturedBodies[0]!.toString("utf8"));
  expect(firstTurnFrames.some((f) => f.type === "TOOL_CALL_END")).toBe(true);
  expect(firstTurnFrames.some((f) => f.type === "TOOL_CALL_RESULT")).toBe(false);
});

test("DA-19g edit：编辑后的参数值真的生效——不是表单能编辑但后端仍用原值", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const { capturedBodies } = await triggerApproval(page);

  const startEditButton = page.getByTestId("copilotkit-v2-hitl-start-edit");
  await expect(startEditButton).toBeVisible({ timeout: 30_000 });
  await startEditButton.click();

  const textarea = page.getByTestId("copilotkit-v2-hitl-edit-textarea");
  await expect(textarea).toBeVisible();
  const EDITED_SUBJECT = "已编辑：请今日发出（DA-19g 实测）";
  const EDITED_BODY = "人工编辑后的正文（DA-19g 实测）";
  const edited = { to: "ops@example.test", subject: EDITED_SUBJECT, body: EDITED_BODY };
  await textarea.fill(JSON.stringify(edited));

  const submitButton = page.getByTestId("copilotkit-v2-hitl-edit-submit");
  await expect(submitButton).toBeEnabled();
  await submitButton.click();

  await expect(page.getByTestId("copilotkit-v2-hitl-dialog")).toHaveCount(0);
  // See the reject test's own comment: this flips to enabled right after turn one's
  // `RUN_FINISHED`, before the human decides -- not a signal the resume completed.
  await expect(page.getByTestId("copilotkit-v2-send")).toBeEnabled({ timeout: 30_000 });
  await expect.poll(() => capturedBodies.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);

  // 核心断言：最终答案里出现的是编辑后的正文，不是原始正文——这正是 UX-9 评估当年
  // 发现、DA-19d backlog 条目提过"这次要顺带解决"的那条真实缺陷。
  const messages = page.locator('[data-testid="copilotkit-v2-messages"]');
  await expect(messages).toContainText(EDITED_BODY, { timeout: 30_000 });
  await expect(messages).not.toContainText("原始正文（未编辑）");
});

test("DA-19g reject：run 真的以 HITL_REJECTED 收场，不是卡在超时也不是静默成功", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const { capturedBodies } = await triggerApproval(page);

  const rejectButton = page.getByTestId("copilotkit-v2-hitl-reject");
  await expect(rejectButton).toBeVisible({ timeout: 30_000 });
  await rejectButton.click();

  await expect(page.getByTestId("copilotkit-v2-hitl-dialog")).toHaveCount(0);
  // DA-19g -- `agent.isRunning` (and therefore this button's `disabled`) already flips back
  // to `false` the moment TURN ONE's own `RUN_FINISHED` lands -- that happens BEFORE the
  // human ever decides anything (the dangling tool call is exactly what makes this "yield
  // control", not "still running", see `writeToolCallStep`'s own doc). So this assertion is
  // true almost immediately after `triggerApproval` returns, NOT a signal that the resume
  // turn has completed -- polling `capturedBodies.length` (the actual network-level fact of
  // a SECOND `POST` having round-tripped) below is what really waits for the resume.
  await expect(page.getByTestId("copilotkit-v2-send")).toBeEnabled({ timeout: 30_000 });
  await expect.poll(() => capturedBodies.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);

  writeFileSync(
    resolve(OUT, "hitl-reject-wire-frames.json"),
    JSON.stringify(capturedBodies.map((b) => parseSseFrames(b.toString("utf8"))), null, 2),
    "utf8",
  );

  // wire 级反证：resume 那一轮以 RUN_ERROR/HITL_REJECTED 收场——这是一个诚实的终态
  // 错误码，不是 AGENT_RUN_TIMEOUT（旧 bug），也不是被悄悄吞掉当成功处理。
  const allFrames = capturedBodies.flatMap((b) => parseSseFrames(b.toString("utf8")));
  const runError = allFrames.find((f) => f.type === "RUN_ERROR");
  expect(runError, JSON.stringify(allFrames)).toBeDefined();
  expect((runError as unknown as { code?: string } | undefined)?.code).toBe("HITL_REJECTED");
});
