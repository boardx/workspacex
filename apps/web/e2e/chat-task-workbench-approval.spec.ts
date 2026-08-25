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
 * issue #2068 —— **TW-P0-6 审批卡片（三态决策）**（判据见 `${ACCEPTANCE_DOC}`）。
 *
 * 人类 2026-08-26 审计原话：
 * > DeepAgents 原生支持 approve / edit / reject 三种决策，界面必须三种都有，不许只做
 * > 一个「确认」：显示 Agent 想做什么 / 为什么 / 影响哪些文件记录或外部对象 /
 * > 参数或变更 diff / 风险等级 / 三个按钮。读操作可静默；写入、删除、发送、支付、
 * > 发布必须按风险分级。
 *
 * ## ⚠ 与审计原文的一处**分歧**（如实记录，不粉饰也不隐瞒）
 * 审计推测界面「只做了一个确认」。2026-08-26 代码级勘探**不成立**：
 * `copilotkit-v2-panel.tsx:421-544` 的 HITL 弹窗已有
 * `copilotkit-v2-hitl-approve` / `-start-edit` / `-reject` 三个按钮，
 * edit 态另有 `-edit-textarea` / `-edit-submit` / `-edit-cancel`。
 * 所以本条**不是零分项**。真实缺口在另外两处，本 spec 逐条钉住：
 *   (a) 五项披露（想做什么/为什么/影响面/diff/风险等级）——当前只有裸参数
 *       `copilotkit-v2-hitl-args`，没有意图、理由、影响面、风险等级；
 *   (b) **风险分级**——当前是「配了 `DEEP_AGENT_HITL_TOOLS` 就一律弹」的开关，
 *       不是按写入/删除/发送/支付/发布分级，读操作也没有静默通道。
 *
 * ## 边界（不重复声明）
 * 「引擎侧三态是否真的打通」属于 `deepagent-capability-rubric.md` **D6**，本 spec 不评。
 * 本条只评**界面披露与风险分级**。
 */

test.setTimeout(240_000);

test("TW-P0-6①：审批界面三态按钮齐（approve / edit / reject）—— 已知当前达标，防回归", async ({ page }) => {
  await openFreshThread(page);
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentApprovalTrigger);
  await page.getByTestId("copilotkit-v2-send").click();

  const dialog = page.getByTestId("copilotkit-v2-hitl-dialog");
  await expect(dialog, "TW-P0-6①：审批触发词没有弹出 HITL 决策弹窗").toBeVisible({ timeout: 120_000 });

  // 三态都必须在。只做一个「确认」按判据封顶 0.3——这条断言就是那道门。
  await expect(page.getByTestId("copilotkit-v2-hitl-approve"), "缺少 approve").toBeVisible();
  await expect(page.getByTestId("copilotkit-v2-hitl-start-edit"), "缺少 edit（在线修改参数后放行）").toBeVisible();
  await expect(page.getByTestId("copilotkit-v2-hitl-reject"), "缺少 reject").toBeVisible();
});

test("TW-P0-6②：审批卡披露五项（想做什么 / 为什么 / 影响面 / diff / 风险等级）", async ({ page }) => {
  await openFreshThread(page);
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentApprovalTrigger);
  await page.getByTestId("copilotkit-v2-send").click();
  await expect(page.getByTestId("copilotkit-v2-hitl-dialog")).toBeVisible({ timeout: 120_000 });

  const card = await expectAnchor(
    page,
    "chat-task-workbench-approval-card",
    "TW-P0-6②",
    "审批弹窗不是结构化审批卡（当前只有裸参数 copilotkit-v2-hitl-args，无意图/理由/影响面/风险）",
    20_000,
  );

  for (const [suffix, what] of [
    ["intent", "Agent 想做什么"],
    ["rationale", "为什么要做"],
    ["impact", "影响哪些文件记录或外部对象"],
    ["diff", "参数或变更 diff"],
    ["risk", "风险等级"],
  ] as const) {
    const testId = `chat-task-workbench-approval-facet-${suffix}`;
    await expect(
      card.getByTestId(testId),
      gapMessage("TW-P0-6②", testId, `审批卡未披露「${what}」`),
    ).toBeVisible({ timeout: 10_000 });
  }

  // 风险等级必须是可判定的枚举，不是一句形容词——否则「按风险分级」无法机械成立。
  await expect(
    card,
    gapMessage("TW-P0-6②", "chat-task-workbench-approval-card", "风险等级不是可判定的枚举 data-risk"),
  ).toHaveAttribute("data-risk", /^(low|medium|high|critical)$/);
});

test("TW-P0-6③：风险分级生效——纯读操作不得弹审批（反证面）", async ({ page }) => {
  await openFreshThread(page);

  // 多步剧本里包含检索这类**纯读**工具调用（既有
  // `copilotkit-v2-tool-rendering.spec.ts` 用同一触发词断言 search_documents 卡片）。
  await sendAndSettle(page, CHAT_READ_E2E.deepAgentMultiStepTrigger);

  await expect(
    page.getByTestId("copilotkit-v2-hitl-dialog"),
    [
      "【差距 TW-P0-6③】一次纯读操作也弹了审批卡。",
      "审计原话：读操作可静默；写入、删除、发送、支付、发布必须按风险分级。",
      "无差别弹审批 = 没有分级，用户很快会习惯性点「同意」，审批就失去意义。",
      `判据见 ${ACCEPTANCE_DOC} 的 TW-P0-6 一节。`,
    ].join("\n"),
  ).toHaveCount(0);

  // 分级的另一半：读操作虽然静默，但仍须在事件流里可审计（不是消失）。
  await expectAnchor(
    page,
    "chat-task-workbench-event-row",
    "TW-P0-6③",
    "读操作静默后连可审计事件都没有——静默不等于不可见",
    30_000,
  );
});
