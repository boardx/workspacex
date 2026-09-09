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

/*
 * issue #3132 —— 态名以**契约枚举 `PlanPhase` 为准**（`packages/contracts/src/plan-control.ts`，
 * `domain.md` 一·5），不是本文件另起的一套（原先写的 `awaiting-approval` / `completed`
 * 在实现里并不存在，对应的真名是 `approving` / `done`）。同一事实不得声明在两处。
 */
const SIX_PHASES = ["preparing", "planning", "executing", "approving", "done", "failed"];
/*
 * 指示器这条线上**只列五格**：签核过的 `contracts/plan-control/ui.md` 2.3 明确写
 * 「`failed` 态不出现在这条线上（它不是第六格），而是替换整条为一行失败摘要 → S6」。
 * 因此这里断言的是那五格；`failed` 由 TW-P0-3⑥ 用 `data-phase="failed"` 断言。
 */
const PHASE_LINE = ["preparing", "planning", "executing", "approving", "done"];

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
  for (const phase of PHASE_LINE) {
    expect(
      rendered,
      gapMessage("TW-P0-3①", "chat-task-workbench-phase-indicator", `六态指示器缺少 ${phase} 这一态`),
    ).toContain(phase);
  }

  // 状态不能只靠颜色（与 TW-A11Y-6 同源的可达性要求）：当前态须有可读文本。
  // `aria-current` 落在**当前那一格**上，不是整条线的根节点（判据一 ②）。
  await expect(indicator.locator('[aria-current="step"]')).toHaveCount(1);
});

test("TW-P0-3②③：计划面板文案面向用户，且可调顺序 / 删步骤 / 加约束", async ({ page }) => {
  await openFreshThread(page);
  // 确定性替身的多步剧本：真实走 DeepAgentModelProvider，会真的产出 write_todos。
  await sendAndSettle(page, CHAT_READ_E2E.deepAgentMultiStepTrigger);

  /*
   * issue #3132 —— **先展开，再锚面板**。
   *
   * 判决 run 34293903801 的 error-context 逐字给出了当时的 DOM：面板在场，
   * 但呈现为折叠摘要 `执行计划 · 本轮已结束 · 0/3 步已标记完成`。
   * `chat-task-workbench-plan-panel` 与 `chat-task-workbench-plan-edit-toggle`
   * 两个锚点在 `copilotkit-v2-plan-control.tsx` 里**都**挂在 `!collapsed` 之下，
   * 而面板按产品设计默认折叠（`collapsed` 初值 true，只有 needsDecision 由 false
   * 翻 true 时自动展开——`done` 态不满足）。这条用例此前从不点展开，于是等的是一段
   * 结构上到不了的 DOM：60s 走满、一条业务断言都没跑到。
   *
   * ⚠ 这是**判据修正，不是放宽**：TW-P0-3②③ 评的是"面板文案面向用户 + 三个编辑
   * 能力真实可用"，从来不含"默认必须展开"（默认折叠是 ui.md 的既有设计）。三条
   * 业务断言与反伪造的删除断言一个字未动。
   */
  const collapseToggle = await expectAnchor(
    page,
    "chat-task-workbench-plan-collapse-toggle",
    "TW-P0-3②",
    "没有用户可读的计划面板（连折叠摘要都没有）",
    60_000,
  );
  if ((await collapseToggle.getAttribute("aria-expanded")) !== "true") await collapseToggle.click();

  const panel = await expectAnchor(
    page,
    "chat-task-workbench-plan-panel",
    "TW-P0-3②",
    "没有用户可读的计划面板（当前只有只读的 copilotkit-v2-tool-write-todos 卡片）",
    60_000,
  );

  // 展开后才由用户显式进入编辑态。
  const editToggle = page.getByTestId("chat-task-workbench-plan-edit-toggle");
  await expect(editToggle).toBeVisible({ timeout: 10_000 });
  await editToggle.click();

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
  await expect(
    firstStep.getByTestId("chat-task-workbench-plan-step-add-constraint"),
    gapMessage("TW-P0-3③", "chat-task-workbench-plan-step-add-constraint", "计划面板不支持为任务步骤追加约束"),
  ).toBeVisible({ timeout: 10_000 });

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
  //
  // issue #3132（B7）：触发词换成 `deepAgentPlanConfirmTrigger`。此前这里用的是
  // `deepAgentMultiStepTrigger`，而那条剧本**从不返回 `interrupted`** ——它演的是
  // 「计划已生效、正在逐步执行」，结构上产不出计划确认中断。对着它要求一道门，
  // 门永远不会出现，红了也读不出真实缺口在哪。两条剧本从此各演各的。
  //
  // ⚠ 这里**不用** `sendAndSettle`：那个 helper 等 `copilotkit-v2-running-indicator`
  // 归零，而这一轮的正确行为恰恰是**停住不结束**。用它等于要求这道门不要生效。
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentPlanConfirmTrigger);
  await page.getByTestId("copilotkit-v2-send").click();
  await expectAnchor(
    page,
    "chat-task-workbench-plan-confirm",
    "TW-P0-3④",
    "复杂多步任务没有「确认计划后再执行」这道门",
    60_000,
  );

  // (a2) ⚠ **引擎侧真的停住了** —— 人类原话：「不能只是 UI 上显示了一个卡片」。
  //
  // 一张渲染出来的卡片证明不了任何事：run 可能在卡片旁边一路跑完。这一段在确认门
  // 出现后**持续观察一段时间**，断言三件事同时成立：
  //   (i)   仍停在 planning（确认门的渲染门就是 `phase === "planning"`，见
  //         `copilotkit-v2-plan-control.tsx`——门还在 ⇔ 阶段还是 planning，
  //         这不是间接证据，是同一个判定）；
  //   (ii)  没有新的工具调用产生；
  //   (iii) 没有执行进度卡（`phase === "executing"` 才渲染）。
  //
  // 撤掉引擎侧的 `when` 谓词 ⇒ 门根本不出现，上面 (a) 先红；把谓词改成「拦了但不
  // 真的停」⇒ (i)(ii)(iii) 在这里红。两种做假各有一条会红的断言接着。
  //
  // ⚠ 刻意**不**依赖 `chat-task-workbench-phase-indicator`：那个组件挂进 /chat 是
  // F4（`fix/3132-failure-state-entry`）的范围，不在本 PR 里。借它做断言会让这条
  // 用例的红绿取决于另一条分支有没有合入——那是在读一个不属于本改动的信号。
  const confirmGate = page.getByTestId("chat-task-workbench-plan-confirm");
  const toolGroups = page.getByTestId("copilotkit-v2-tool-calls-group");
  const toolGroupsBefore = await toolGroups.count();
  const HOLD_MS = 6_000;
  const deadline = Date.now() + HOLD_MS;
  while (Date.now() < deadline) {
    await expect(
      confirmGate,
      [
        "【差距 TW-P0-3④】确认门出现了，但引擎侧并没有真的停住——阶段已经离开 planning。",
        "判据：run 必须停在 awaiting_tool_permission 直到用户确认，不是画一张卡片给用户看。",
        `判据见 ${ACCEPTANCE_DOC} 的 TW-P0-3 一节。`,
      ].join("\n"),
    ).toHaveCount(1);
    expect(
      await toolGroups.count(),
      "【差距 TW-P0-3④】等待确认期间引擎又发起了新的工具调用——它没有真的停住。",
    ).toBe(toolGroupsBefore);
    expect(
      await page.getByTestId("chat-task-workbench-run-progress").count(),
      "【差距 TW-P0-3④】等待确认期间出现了执行进度卡——计划在用户确认之前就开始执行了。",
    ).toBe(0);
    await page.waitForTimeout(1_000);
  }

  // (a3) 确认之后**执行真的继续** —— 否则这道门就成了一个死锁，比没有门更坏。
  // 确认走的是 `decideToolPermission → Command(resume=…)`（恢复停住的那条 run，
  // 人类裁决 O-2），不是 `confirmPlan` 新起一条。
  await page.getByTestId("chat-task-workbench-plan-confirm-run").click();
  await expect(
    confirmGate,
    [
      "【差距 TW-P0-3④】点了「确认并执行」之后确认门仍在——这一轮没有真的往下走。",
      "确认必须真的恢复停住的那条 run，而不是一个点了没反应的按钮。",
    ].join("\n"),
  ).toHaveCount(0, { timeout: 60_000 });
  await expect(
    page.getByTestId("copilotkit-v2-running-indicator"),
    "【差距 TW-P0-3④】确认之后这一轮始终没有落定——恢复的那条 run 没有跑完。",
  ).toHaveCount(0, { timeout: 120_000 });

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

  /*
   * issue #3132 —— 同 ②③ 那段：`PlanRunProgress` 的渲染门是
   * `(!collapsed || pausedAt || pauseRequestedAt) && runLive && currentStep`，
   * 折叠态下这张卡不在 DOM 里。先展开，再要求它出现。
   */
  const collapseToggle = page.getByTestId("chat-task-workbench-plan-collapse-toggle");
  await expect(collapseToggle).toBeVisible({ timeout: 60_000 });
  if ((await collapseToggle.getAttribute("aria-expanded")) !== "true") await collapseToggle.click();

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

test("TW-P0-3⑥：失败态说明失败步骤，并给出契约支持的重试该步 / 修改输入", async ({ page }) => {
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
  ] as const) {
    const testId = `chat-task-workbench-failure-${suffix}`;
    await expectAnchor(page, testId, "TW-P0-3⑥", `失败态没有提供「${what}」这个恢复动作`, 20_000);
  }

  // `packages/contracts/src/plan-control.ts` 明确删除了任意历史 checkpoint 恢复，
  // 且契约测试机械禁止该 action。Web 不渲染一个无法调用统一契约的假按钮。
  await expect(page.getByTestId("chat-task-workbench-failure-restore-checkpoint")).toHaveCount(0);
});
