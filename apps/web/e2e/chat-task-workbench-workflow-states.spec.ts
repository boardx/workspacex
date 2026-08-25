import { test, expect } from "@playwright/test";
import {
  ACCEPTANCE_DOC,
  CHAT_READ_E2E,
  expectAnchor,
  gapMessage,
  openFreshThread,
  sendAndSettle,
} from "./chat-task-workbench-fixture";

/**
 * issue #2068 —— **TW-P0-3 六态工作流与可编辑计划**（判据见 `${ACCEPTANCE_DOC}`）。
 *
 * 人类 2026-08-26 审计原话：
 * > 准备 → 计划 → 执行 → 审批 → 完成 → 失败。计划面板直接映射 DeepAgents 的
 * > `write_todos`，但文案面向用户（✓ 理解需求 / ● 对比竞品 / ○ 生成报告），允许调
 * > 顺序、删步骤、加约束；复杂任务先确认计划，简单问题直接回答（不许每次都加一道
 * > 门槛）。执行态显示当前步骤、完成比例、耗时、可暂停。失败态说明失败步骤 +
 * > 重试该步 / 修改输入 / 恢复检查点。
 *
 * ## 与既有两卡的边界（同一事实不得声明在两处）
 * - 引擎能否产出结构化 todo → `deepagent-capability-rubric.md` **D1**，本 spec 不评。
 * - todo 是否实时可见 → `chat-ux-acceptance-criteria.md` **第 2 项**，本 spec 不评。
 * - **本 spec 只评「用户可控」**：状态机是否显式、计划是否可编辑、确认门是否条件性、
 *   执行是否可暂停、失败是否给得出三个恢复动作。
 *
 * ⚠ 「正在调用中」这个单次工具在途态，人类 2026-08-10 已裁决**不做**
 * （`chat-ux-acceptance-criteria.md` 人类裁决记录，路径 B）。本 spec 断言的
 * 「执行态进度」是 **todo 步骤级**完成比例，不是单次工具调用的在途态——不要
 * 把这条读成重开那个裁决。
 *
 * ## 当前实现（2026-08-26 勘探）
 * 只有一行自由文本状态 `copilotkit-v2-thinking-phase`（`lib/agent-run-phase.ts`），
 * 没有六态枚举；`WriteTodosCard`（`copilotkit-v2-tool-renderers.tsx:78`）是只读
 * `<ul>`，没有任何按钮；没有确认门、没有暂停、没有失败恢复动作。
 */

test.setTimeout(240_000);

const SIX_PHASES = ["preparing", "planning", "executing", "awaiting-approval", "completed", "failed"];

test("TW-P0-3①：存在显式六态工作流指示器（准备/计划/执行/审批/完成/失败）", async ({ page }) => {
  await openFreshThread(page);

  const indicator = await expectAnchor(
    page,
    "chat-task-workbench-phase-indicator",
    "TW-P0-3①",
    "没有六态工作流指示器（当前只有一行自由文本 copilotkit-v2-thinking-phase）",
    30_000,
  );

  // 当前态必须是六态之一的**枚举值**，不是自由文本——自由文本无法被用户或机器
  // 可靠判断「现在到哪一步了」。
  await expect(
    indicator,
    gapMessage("TW-P0-3①", "chat-task-workbench-phase-indicator", "当前态不是六态枚举"),
  ).toHaveAttribute("data-phase", new RegExp(`^(${SIX_PHASES.join("|")})$`));

  // 指示器必须把六态全部呈现出来（stepper 语义），用户才知道自己在整条链的哪里，
  // 而不是只看到一个孤立的当前值。
  const steps = indicator.locator("[data-phase-step]");
  const rendered = await steps.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-phase-step")));
  for (const phase of SIX_PHASES) {
    expect(
      rendered,
      gapMessage("TW-P0-3①", "chat-task-workbench-phase-indicator", `六态指示器缺少 ${phase} 这一态`),
    ).toContain(phase);
  }

  // 状态不能只靠颜色（与 TW-A11Y-6 同源的可达性要求）：当前态须有可读文本。
  await expect(indicator).toHaveAttribute("aria-current", /step|true/);
});

test("TW-P0-3②③：计划面板文案面向用户，且可调顺序 / 删步骤 / 加约束", async ({ page }) => {
  await openFreshThread(page);
  // 确定性替身的多步剧本：真实走 DeepAgentModelProvider，会真的产出 write_todos。
  await sendAndSettle(page, CHAT_READ_E2E.deepAgentMultiStepTrigger);

  const panel = await expectAnchor(
    page,
    "chat-task-workbench-plan-panel",
    "TW-P0-3②",
    "没有用户可读的计划面板（当前只有只读的 copilotkit-v2-tool-write-todos 卡片）",
    60_000,
  );

  // ② 文案面向用户：不得把工具名 `write_todos` 印在界面上。
  expect(
    (await panel.innerText()),
    gapMessage("TW-P0-3②", "chat-task-workbench-plan-panel", "计划面板暴露了内部工具名 write_todos"),
  ).not.toMatch(/write_todos/i);

  const steps = page.getByTestId("chat-task-workbench-plan-step");
  expect(
    await steps.count(),
    gapMessage("TW-P0-3②", "chat-task-workbench-plan-step", "计划面板里没有任何步骤条目"),
  ).toBeGreaterThan(0);

  // ③ 三个编辑能力，逐个锚：调顺序 / 删步骤 / 加约束。
  const firstStep = steps.first();
  for (const [suffix, what] of [
    ["reorder", "调整步骤顺序"],
    ["delete", "删除步骤"],
  ] as const) {
    const testId = `chat-task-workbench-plan-step-${suffix}`;
    await expect(
      firstStep.getByTestId(testId),
      gapMessage("TW-P0-3③", testId, `计划步骤不支持${what}`),
    ).toBeVisible({ timeout: 10_000 });
  }
  await expectAnchor(page, "chat-task-workbench-plan-add-constraint", "TW-P0-3③", "计划面板不支持为任务追加约束");

  // 反伪造条款：删除必须真的生效，不是点了没反应的假按钮。
  const before = await steps.count();
  await firstStep.getByTestId("chat-task-workbench-plan-step-delete").click();
  await expect
    .poll(async () => steps.count(), { timeout: 15_000 })
    .toBe(before - 1);
});

test("TW-P0-3④：复杂任务先确认计划，简单问题不加门槛（条件性确认门）", async ({ page }) => {
  await openFreshThread(page);

  // (a) 复杂任务 → 必须先出确认门。
  await sendAndSettle(page, CHAT_READ_E2E.deepAgentMultiStepTrigger);
  await expectAnchor(
    page,
    "chat-task-workbench-plan-confirm",
    "TW-P0-3④",
    "复杂多步任务没有「确认计划后再执行」这道门",
    60_000,
  );

  // (b) 简单问题 → **不得**被加上同一道门。这是反证面：审计原话
  //     「不许每次都加一道门槛」。做成无条件确认门同样判不达标。
  const simplePage = await page.context().newPage();
  await openFreshThread(simplePage);
  await sendAndSettle(simplePage, "你好");
  await expect(
    simplePage.getByTestId("chat-task-workbench-plan-confirm"),
    [
      "【差距 TW-P0-3④】简单提问也被加上了计划确认门——审计原话「不许每次都加一道门槛」。",
      "确认门必须是条件性的：复杂任务先确认，简单问题直接回答。",
      `判据见 ${ACCEPTANCE_DOC} 的 TW-P0-3 一节。`,
    ].join("\n"),
  ).toHaveCount(0);
  await simplePage.close();
});

test("TW-P0-3⑤：执行态显示当前步骤 / 完成比例 / 耗时，且可暂停", async ({ page }) => {
  await openFreshThread(page);
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentMultiStepTrigger);
  await page.getByTestId("copilotkit-v2-send").click();

  const progress = await expectAnchor(
    page,
    "chat-task-workbench-run-progress",
    "TW-P0-3⑤",
    "执行态没有步骤级进度（当前步骤 / 完成比例 / 耗时）",
    60_000,
  );

  // 完成比例必须是机器可读的数值，不是一句「正在处理」。
  await expect(
    progress,
    gapMessage("TW-P0-3⑤", "chat-task-workbench-run-progress", "没有可判定的完成比例 data-completed/data-total"),
  ).toHaveAttribute("data-completed", /^\d+$/);
  await expect(progress).toHaveAttribute("data-total", /^\d+$/);
  await expect(
    progress,
    gapMessage("TW-P0-3⑤", "chat-task-workbench-run-progress", "执行态没有显示耗时"),
  ).toHaveAttribute("data-elapsed-ms", /^\d+$/);

  await expectAnchor(page, "chat-task-workbench-run-pause", "TW-P0-3⑤", "执行中不能暂停", 20_000);
});

test("TW-P0-3⑥：失败态说明失败步骤，并给出重试该步 / 修改输入 / 恢复检查点", async ({ page }) => {
  await openFreshThread(page);
  // 确定性替身的失败剧本（既有 `copilotkit-v2-error-banner.spec.ts` 在用同一个触发词）。
  await sendAndSettle(page, CHAT_READ_E2E.deepAgentFailureTrigger);

  const indicator = page.getByTestId("chat-task-workbench-phase-indicator");
  await expect(
    indicator,
    gapMessage("TW-P0-3⑥", "chat-task-workbench-phase-indicator", "任务失败后工作流没有进入 failed 态"),
  ).toHaveAttribute("data-phase", "failed", { timeout: 60_000 });

  for (const [suffix, what] of [
    ["retry-step", "重试该步"],
    ["edit-input", "修改输入"],
    ["restore-checkpoint", "恢复检查点"],
  ] as const) {
    const testId = `chat-task-workbench-failure-${suffix}`;
    await expectAnchor(page, testId, "TW-P0-3⑥", `失败态没有提供「${what}」这个恢复动作`, 20_000);
  }
});
