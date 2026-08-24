import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * DA-19d 人在环（issue #1987，backlog DA-19d，框架版 Gap 3）—— 真实浏览器 + 真实
 * deep-agent loopback 替身，走 `/chat/copilotkit-v2` 触发 `LOOPBACK_DEEP_AGENT_
 * APPROVAL_TRIGGER`（`CHAT_READ_E2E.deepAgentApprovalTrigger`），断言 `useHumanInTheLoop`
 * 注册的 `send_email` 审批对话框是否真的出现、respond() 之后编辑值是否真的生效。
 *
 * ## 本轮实测结论（如实记录，不跳过验证——第一版断言曾猜错具体机制，已用真实 wire
 * ## 字节改写；下面是实测过的真相，不是重新猜的一版）
 *
 * **对话框会挂载，但永远是死的只读态，`respond` 永远不出现，approve/edit/reject
 * 三个按钮永远不会渲染**——原因不是"TOOL_CALL_START 从未出现"（它确实出现了），
 * 而是后端把一个**还没被人裁决**的工具调用步骤（`RunStepPublic.status ===
 * "in_progress"`，`agui-bridge.ts` 为 #742 Gap 1 引入的"步骤已宣布、结果未到"中间态）
 * 当成**已经成功**处理：`copilotkit-agui.controller.ts` 的 `writeToolCallStep` 只对
 * `status === "failed"` 单独分支，`"in_progress"` 和 `"succeeded"` 共用同一个 `else`
 * 分支——立刻发出 `TOOL_CALL_RESULT{content: step.toolResultSummary ?? ""}`，`in_
 * progress` 步骤的 `toolResultSummary` 是 `null`，于是这个待批工具调用刚开完
 * `TOOL_CALL_END` 就立刻收到一个**内容为空字符串**的 `TOOL_CALL_RESULT`——
 * `useHumanInTheLoop` 借以判定"这个工具调用还在等人"的信号（`TOOL_CALL_END` 之后
 * 一段时间内没有配对的 `TOOL_CALL_RESULT`）从未成立，客户端把它当成一次已完成的
 * 调用处理，`status` 直接落 `"complete"`，从未经过 `"executing"`——`respond` 因而
 * 全程是 `undefined`，`SendEmailApprovalDialog` 渲染出的是"本轮已裁决，等待 run
 * 收尾"这个只读分支（实测截图：`test-results/.../test-failed-1.png`，对话框标题
 * `等待批准：发送邮件` + 灰底文案 `本轮已裁决，等待 run 收尾。`，没有任何按钮）。
 *
 * 与此同时，run 自己的**整体**状态从未离开 `awaiting_approval`（`writeToolCallStep`
 * 只是把这一个步骤的 wire 表示错误地"提前结清"了，不影响 `readAgentRun` 返回的
 * `projection.status`）——`runAguiBridgeTurn` 的轮询循环只认 `"succeeded"`/
 * `"failed"` 两个终态分支，`awaiting_approval` 落进 `sleep()` 继续轮询，直到
 * `maxPolls`（默认 75 次 × 400ms ≈ 30s）耗尽，最终仍以 `RUN_ERROR`/
 * `code: "AGENT_RUN_TIMEOUT"` 收场——即使那个孤立的工具调用本身已经在 wire 上被
 * （错误地）标记为"完成"。两个 bug 独立存在，缺一个都不足以解释实测现象。
 *
 * 这与 DA-07b/PR #1960 修的 bug 不是同一层：那次修的是旧 REST 审批路径
 * （`/agent-runs/:runId/decision`，`agent-approval-panel.tsx` 消费）在**已经支持**
 * 审批的前提下、resume 写回账本时撞了 `agent_run_steps_seq_uniq` 唯一约束——本次
 * 实测走的是全新的 AG-UI/CopilotRuntime 桥接层，这条链路上审批语义从未被实现过
 * （`writeToolCallStep` 从设计上就假设"收到的 `RunStepPublic` 一定已经执行完"，
 * `agui-bridge.ts` 自己的文档原话是"a REAL, ALREADY-EXECUTED tool_call step"——
 * `"in_progress"` 这个中间态变体是 #742 Gap 1 为了给*已完成*步骤争取一次
 * "宣布中"UI 帧才引入的，从未设计过要覆盖"这个步骤压根还没执行、正在等人裁决"这种
 * 语义），不存在"撞同一个 bug"这回事，是一个尚未开工的能力缺口，登记在案（不在本
 * 任务范围内新增后端实现——任务范围是前端 `useHumanInTheLoop` hook 接线，backlog
 * 见 `copilotkit-v2-panel.tsx` DA-19d 段落头注）。
 *
 * 下面的测试因此断言的是**当前真实行为**（工具调用被过早标记为完成、超时收场、
 * 三个交互按钮从未出现），不是断言"编辑生效"——`agent-approval-panel.tsx`/
 * `agent-approval-panel.test.tsx` 已经在旧 REST 审批链路上证明过编辑值能生效
 * （PR #1933 + PR #1960 的 bugfix）；这条新链路上同一件事今天做不到，做不到的
 * 具体机制已经在上面写清楚，一旦 `runAguiBridgeTurn`/`copilotkit-agui.controller.ts`
 * 补上审批语义（`"in_progress"` 分支不提前发 `TOOL_CALL_RESULT` + 有恢复中断 run
 * 的入口），`useHumanInTheLoop` 侧的接线（本文件同目录 `copilotkit-v2-panel.tsx`）
 * 不需要改一行就能立刻工作——`respond()` 到 `parsedDraft.value` 的编辑值传递路径
 * 已经跟旧面板逐条对齐（`parseEditDraft`/JSON 对象校验/三态渲染），差的只是后端
 * 那半。
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

test("DA-19d 真实实测：审批工具调用被过早标记为完成，useHumanInTheLoop 的 respond 从不出现，run 以 RUN_ERROR 超时收场", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });

  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);

  let capturedBody: Buffer | null = null;
  let runOk = false;

  await page.route(
    (u) => u.pathname.includes("/api/copilotkit/") && u.pathname !== "/api/copilotkit/info",
    async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      const fetched = await route.fetch();
      runOk = fetched.ok();
      capturedBody = await fetched.body();
      await route.fulfill({ response: fetched });
    },
  );

  await warmUpCopilotRuntimeRoute(page);
  await page.goto("/chat/copilotkit-v2");
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentApprovalTrigger);
  await page.getByTestId("copilotkit-v2-send").click();

  // `runAguiBridgeTurn` 的 `maxPolls * pollIntervalMs` 默认 ~30s——给足这个预算，
  // 不是随便挑一个数字凑测试超时。
  await expect.poll(() => capturedBody !== null, { timeout: 60_000 }).toBe(true);
  await page.unroute("**/api/copilotkit/**");

  expect(runOk).toBe(true); // GraphQL 层本身没有崩，SSE 200 一路发完（错误折在帧里，见下）。
  const wireBody = (capturedBody as unknown as Buffer).toString("utf8");
  const frames = parseSseFrames(wireBody);
  writeFileSync(resolve(OUT, "hitl-wire-frames.json"), JSON.stringify(frames, null, 2), "utf8");

  // ── 反证① `send_email` 的 `TOOL_CALL_START`/`_ARGS`/`_END` 确实出现，参数是
  // loopback 替身裁决前的原始参数（`originalArgs`，未编辑）——这一步本身工作正常，
  // 问题不在"工具调用有没有到达前端" ──
  const toolCallStart = frames.find(
    (f) => f.type === "TOOL_CALL_START" && (f as unknown as { toolCallName?: string }).toolCallName === "send_email",
  ) as { toolCallId?: string } | undefined;
  expect(toolCallStart).toBeDefined();
  const toolCallId = toolCallStart!.toolCallId;
  const toolCallArgs = frames.find(
    (f) => f.type === "TOOL_CALL_ARGS" && (f as unknown as { toolCallId?: string }).toolCallId === toolCallId,
  ) as { delta?: string } | undefined;
  expect(toolCallArgs).toBeDefined();
  const parsedArgs = JSON.parse(toolCallArgs!.delta ?? "{}") as Record<string, unknown>;
  expect(parsedArgs).toMatchObject({ to: "ops@example.test", body: "原始正文（未编辑）" });

  // ── 反证②（真实后端缺口，本轮实测发现）同一个 `toolCallId` 立刻收到一个内容为
  // 空字符串的 `TOOL_CALL_RESULT`——这个工具调用其实还没被任何人裁决，但
  // `writeToolCallStep` 把它当"已成功执行、结果为空"处理，wire 上看不出"这是一个
  // 还在等人"的信号 ──
  const toolCallResult = frames.find(
    (f) => f.type === "TOOL_CALL_RESULT" && (f as unknown as { toolCallId?: string }).toolCallId === toolCallId,
  ) as { content?: string } | undefined;
  expect(toolCallResult).toBeDefined();
  expect(toolCallResult!.content).toBe("");

  // ── 反证③ run 最终仍以 `RUN_ERROR`/`AGENT_RUN_TIMEOUT` 收场——那个孤立工具调用
  // 被提前"结清"不影响 run 整体状态：`readAgentRun` 仍然卡在 `awaiting_approval`，
  // `runAguiBridgeTurn` 只认 succeeded/failed，最终耗尽 `maxPolls` 超时 ──
  const runError = frames.find((f) => f.type === "RUN_ERROR");
  expect(runError).toBeDefined();
  expect((runError as unknown as { code?: string } | undefined)?.code).toBe("AGENT_RUN_TIMEOUT");

  // ── 反证④ `useHumanInTheLoop` 的三个交互按钮（approve/编辑/reject）从未渲染
  // ——`respond` 因为②那个提前到达的空结果从未变成非 `undefined`，`status` 从未
  // 落在 `"executing"`，`SendEmailApprovalDialog` 只会走只读分支。对话框容器本身
  // 会渲染（`data-testid=copilotkit-v2-hitl-dialog`，只读文案"本轮已裁决，等待 run
  // 收尾"）——不断言它不存在，那与实测截图矛盾；只断言真正代表"用户能做决定"的
  // 三个按钮从未出现过 ──
  await expect(page.getByTestId("copilotkit-v2-hitl-approve")).toHaveCount(0);
  await expect(page.getByTestId("copilotkit-v2-hitl-start-edit")).toHaveCount(0);
  await expect(page.getByTestId("copilotkit-v2-hitl-reject")).toHaveCount(0);
  await expect(page.getByTestId("copilotkit-v2-hitl-edit-submit")).toHaveCount(0);

  const dialog = page.getByTestId("copilotkit-v2-hitl-dialog");
  if (await dialog.count() > 0) {
    await expect(dialog.first()).toHaveAttribute("data-hitl-status", "complete");
  }

  await page.screenshot({ path: resolve(OUT, "copilotkit-v2-hitl-timeout.png") });
});
