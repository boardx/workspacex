import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { DEEP_AGENT_HITL_TOOL_NAME } from "@repo/contracts/deep-agent-hitl";

/**
 * DA-19g HITL 审批语义（issue #1987 起点，最终修复登记在 DA-19g HITL 审批语义任务）
 * —— 真实浏览器 + 真实 deep-agent loopback 替身，走 `/chat` 触发
 * `deepAgentApprovalTrigger`（`CHAT_READ_E2E.deepAgentApprovalTrigger`），断言
 * `useHumanInTheLoop` 注册的审批对话框的 approve/编辑/reject 三条路径
 * （工具名与参数形状取自 `@repo/contracts` 的 `deep-agent-hitl.ts`，替身与真实引擎
 * 共用同一份声明——issue #2017 修掉了"两边各写死一个 `send_email`"的旧形态）
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

/**
 * issue #2175 复核 -- 三条测试原来的 `await expect(sendButton).toBeEnabled()` 断言
 * 隐含假设"没有别的原因会让发送按钮保持 disabled"。这条假设在 issue #2130（TW-P0-5④，
 * commit `49cda935`）之后不再成立：composer 在 `send()` 成功后会清空
 * （`copilotkit-v2-panel.tsx` 的 `setInputDraft("")`），而 `sendDisabledReason` 现在
 * 对"输入为空"单独给一条禁用理由（"请先输入任务目标"）——这是 TW-P0-5④ 刻意加的、
 * 独立于 `agent.isRunning` 的合法禁用态，不是本文件要覆盖的行为。
 *
 * 三条测试真正要证明的是"resume 之后 run 不再卡在 `awaiting_approval`（`agent.isRunning`
 * 不再让按钮卡死）"，不是"composer 恰好非空所以按钮恰好可点"——这三条测试从未在断言
 * 这一步往输入框里填过字，`toBeEnabled()` 断言的其实是一个从未被它们自己满足过的前提。
 * 直接读 `title`（`sendDisabledReason` 的镜像，见 `copilotkit-v2-panel.tsx`
 * `title={sendDisabledReason ?? undefined}`）比对是不是还停在"Agent 正在处理上一条
 * 消息"这一条，是唯一不与"输入为空"这条独立、合法的禁用理由混在一起的判据
 * （本轮独立复验：把这条换成 `not.toBe(RUNNING_DISABLED_REASON)` 后，
 * 三条测试全部通过，且 wire 级/最终文案断言原样保留、未被削弱——证明 resume 机制
 * 本身没有问题，问题在断言选错了信号源）。
 */
async function expectSendNotBlockedOnRun(
  page: import("@playwright/test").Page,
  timeoutMs = 30_000,
): Promise<void> {
  await expect
    // 2026-09-02 composer 重设计：Agent 处理中发送按钮变为「停止生成」（title 不再是禁用理由），
    // 改读 `data-send-state`（running / disabled / ready）——语义相同：不再卡在运行中。
    .poll(() => page.getByTestId("copilotkit-v2-send").getAttribute("data-send-state"), { timeout: timeoutMs })
    .not.toBe("running");
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
  await page.goto("/chat");
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

  // ── issue #2017 的核心断言：**线上真的发的那个工具名，就是契约里的那个** ──
  //
  // 这条以前不存在，正是这套 e2e 长期"全绿但空转"的原因：它只断言"审批卡出现了"，
  // 而审批卡出现只证明 loopback 替身发的名字与前端注册的名字一致——当年这两处都写死
  // 同一个 `send_email`，于是恒真；真实引擎发 `call_skill`，前端不认，生产恒红，
  // 而这套 e2e 一路绿。断言"卡片出现了"守不住工具名，必须直接断言 wire 上的名字。
  const toolCallNames = capturedBodies
    .flatMap((b) => parseSseFrames(b.toString("utf8")))
    .filter((f) => f.type === "TOOL_CALL_START")
    .map((f) => f["toolCallName"]);
  expect(toolCallNames, "事件流里没有任何 TOOL_CALL_START").not.toHaveLength(0);
  expect(toolCallNames).toContain(DEEP_AGENT_HITL_TOOL_NAME);

  const args = await page.getByTestId("copilotkit-v2-hitl-args").textContent();
  expect(args).toContain("quarterly-report");
  expect(args).toContain("原始参数，未编辑");

  await approveButton.click();

  // 对话框立刻卸载（`close()` 在 `respond()` 之前同步调用）——不是等 run 收尾才关。
  await expect(page.getByTestId("copilotkit-v2-hitl-dialog")).toHaveCount(0);

  // ── 反证②：run 真的继续执行完成，最终答案里能看到「已按原参数执行」——不是卡在
  // `awaiting_approval` 直到 30s 超时收场（旧行为：`RUN_ERROR AGENT_RUN_TIMEOUT`） ──
  // `agent.isRunning` (this button's `disabled`) already flips back to `false` the moment
  // TURN ONE's `RUN_FINISHED` lands, BEFORE the human decides anything -- see
  // `copilotkit-v2-hitl.spec.ts`'s reject test for the full explanation. Waiting on the
  // actual network-level fact (a second `POST` having round-tripped) is what really proves
  // the resume happened, before asserting on its rendered content.
  //
  // issue #2175 -- 不能直接断言 `toBeEnabled()`：这个 composer 在 `triggerApproval`
  // 里发过一次消息后已经清空，"输入为空"本身就是一条独立、合法的禁用理由（TW-P0-5④，
  // `sendDisabledReason`），与"是不是还卡在 run 里"无关。见 `expectSendNotBlockedOnRun`
  // 头注（本轮独立复验：换成这条判据后三个 HITL 测试全部通过，wire/文案断言未削弱）。
  await expectSendNotBlockedOnRun(page);
  await expect.poll(() => capturedBodies.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  await expect(page.locator('[data-testid="copilotkit-v2-messages"]')).toContainText(
    "已按原参数执行", { timeout: 30_000 },
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
  const EDITED_TASK = "人工编辑后的任务描述（issue #2017 实测）";
  const edited = { skill_stable_name: "quarterly-report", task: EDITED_TASK };
  await textarea.fill(JSON.stringify(edited));

  const submitButton = page.getByTestId("copilotkit-v2-hitl-edit-submit");
  await expect(submitButton).toBeEnabled();
  await submitButton.click();

  await expect(page.getByTestId("copilotkit-v2-hitl-dialog")).toHaveCount(0);
  // See the reject test's own comment: this flips to enabled right after turn one's
  // `RUN_FINISHED`, before the human decides -- not a signal the resume completed.
  // issue #2175 -- see `expectSendNotBlockedOnRun`'s own doc: composer is empty here
  // ("请先输入任务目标" is its own legitimate disabled reason, unrelated to the resume).
  await expectSendNotBlockedOnRun(page);
  await expect.poll(() => capturedBodies.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);

  // 核心断言：最终答案里出现的是编辑后的正文，不是原始正文——这正是 UX-9 评估当年
  // 发现、DA-19d backlog 条目提过"这次要顺带解决"的那条真实缺陷。
  const messages = page.locator('[data-testid="copilotkit-v2-messages"]');
  await expect(messages).toContainText(EDITED_TASK, { timeout: 30_000 });
  await expect(messages).not.toContainText("原始参数，未编辑");
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
  // issue #2175 -- see `expectSendNotBlockedOnRun`'s own doc: composer is empty here too.
  await expectSendNotBlockedOnRun(page);
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
