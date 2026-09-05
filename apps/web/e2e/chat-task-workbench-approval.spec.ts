import { test, expect } from "@playwright/test";
import {
  ACCEPTANCE_DOC,
  CHAT_READ_E2E,
  expectAnchor,
  openFreshThread,
  sendAndSettle,
} from "./chat-task-workbench-fixture";

/**
 * issue #2068 —— **TW-P0-6 审批卡片（四选一决策）**（判据见 `${ACCEPTANCE_DOC}`）。
 *
 * 人类 2026-08-26 审计原话：
 * > DeepAgents 原生支持 approve / edit / reject 三种决策，界面必须三种都有，不许只做
 * > 一个「确认」：显示 Agent 想做什么 / 为什么 / 影响哪些文件记录或外部对象 /
 * > 参数或变更 diff / 风险等级 / 三个按钮。读操作可静默；写入、删除、发送、支付、
 * > 发布必须按风险分级。
 *
 * ## 2026-09-05 更新（issue #2767）—— 两个差距都已收口，判据换成真实实现
 *
 * 这份文件的上一版记录了两个真实差距：(a) 审批弹窗只有裸参数，没有意图/理由/影响面/
 * 风险等级；(b) 风险分级是"配了 `DEEP_AGENT_HITL_TOOLS` 就一律弹"的开关，不按操作
 * 本身分级。issue #2767（devapp 实测：调用 `pdf-create` 不该弹审批）把两者一并修掉：
 * - `call_skill` 的风险按目标 skill 判定（平台官方 skill L0、frontmatter 声明、
 *   缺省 L1），只有真正的 L2 才弹——这正是(b)要的"按操作本身分级"，不是工具名开关；
 * - F08 签核的 `ToolPermissionCard`（`components/agent-kernel/agent-kernel-units.tsx`）
 *   接入 `/chat`，披露"想做什么/为什么/影响范围/完整参数/风险等级"五项，且是
 *   **四选一**（仅本次/本 run 内/以后都允许/拒绝，契约 `ToolPermissionDecisionKind`）
 *   而不是原审计要求的三态——四选一是更细的粒度，覆盖三态要求的同时多了"记住"这一档。
 *
 * 「引擎侧四选一是否真的打通」（F06 `decideToolPermission` 的状态机与授权持久化）
 * 属于后端反证，见 `apps/api/tests/agent-run/{risk-tiering-and-states,permission-
 * grant-scopes}.test.ts`；本 spec 只评**界面披露与风险分级**这两件事在真栈里的真实
 * 行为。
 */

test.setTimeout(240_000);

test("TW-P0-6①：审批界面四选一按钮齐（仅本次 / 本 run 内 / 以后都允许 / 拒绝）", async ({ page }) => {
  await openFreshThread(page);
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentApprovalTrigger);
  await page.getByTestId("copilotkit-v2-send").click();

  const dialog = page.getByTestId("chat-tool-permission-dialog");
  await expect(
    dialog,
    "TW-P0-6①：没有等到工具权限确认弹层——这一轮没有真的停下来等人批准（HITL 未触发），不是按钮缺失。",
  ).toBeVisible({ timeout: 120_000 });

  // 四档都必须在——三态审计判据的超集，只做一个「确认」按判据封顶 0.3——这条断言就是那道门。
  await expect(page.getByTestId("perm-once"), "缺少「仅本次允许」").toBeVisible();
  await expect(page.getByTestId("perm-run"), "缺少「本 run 内都允许」").toBeVisible();
  await expect(page.getByTestId("perm-always"), "缺少「以后都允许」").toBeVisible();
  await expect(page.getByTestId("perm-deny"), "缺少「拒绝」").toBeVisible();

  // 收尾：拒绝，让 run 干净结束，不留挂起的审批（后续测试用例互不干扰）。
  await page.getByTestId("perm-deny").click();
});

test("TW-P0-6②：审批卡披露五项（想做什么 / 为什么 / 影响面 / 完整参数 / 风险等级）", async ({ page }) => {
  await openFreshThread(page);
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentApprovalTrigger);
  await page.getByTestId("copilotkit-v2-send").click();
  await expect(page.getByTestId("chat-tool-permission-dialog")).toBeVisible({ timeout: 120_000 });

  const card = await expectAnchor(
    page,
    "tool-permission-card",
    "TW-P0-6②",
    "审批弹窗不是结构化审批卡",
    20_000,
  );

  await expect(card.getByTestId("perm-intent"), "审批卡未披露「Agent 想做什么」").toBeVisible({ timeout: 10_000 });
  await expect(card.getByTestId("perm-rationale"), "审批卡未披露「为什么要做」").toBeVisible({ timeout: 10_000 });
  await expect(card.getByTestId("perm-affects"), "审批卡未披露「影响哪些文件记录或外部对象」").toBeVisible({ timeout: 10_000 });
  // I-3：完整参数（不是摘要）承载"变更 diff"这一项——call_skill 没有文件级 diff，
  // 完整参数就是这次调用唯一的、未截断的"变更内容"。
  await expect(card.getByTestId("perm-command"), "审批卡未披露完整参数").toBeVisible({ timeout: 10_000 });

  // 风险等级必须是可判定的枚举，不是一句形容词——只有 L2 会走到这张卡（L0/L1 由
  // `domain/agent-run/skill-risk-level.ts` 在网关侧直接放行，根本不会 interrupt）。
  await expect(card.getByTestId("risk-L2"), "审批卡未披露可判定的风险等级").toBeVisible({ timeout: 10_000 });

  await page.getByTestId("perm-deny").click();
});

test("TW-P0-6③：风险分级生效——纯读操作不得弹审批（反证面）", async ({ page }) => {
  await openFreshThread(page);

  // 多步剧本里包含检索这类**纯读**工具调用（既有
  // `copilotkit-v2-tool-rendering.spec.ts` 用同一触发词断言 search_documents 卡片）。
  await sendAndSettle(page, CHAT_READ_E2E.deepAgentMultiStepTrigger);

  await expect(
    page.getByTestId("chat-tool-permission-dialog"),
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

/**
 * issue #2767 的核心修复（平台官方 skill 是 L0、不再弹审批）需要一条真正挂载了
 * `pdf-create` 的线程才能忠实复现——本文件既有的 loopback 触发词固定走
 * `skill_stable_name: "quarterly-report"`（一个从未真实挂载的技能，见
 * `copilotkit-v2-hitl.spec.ts` 头注：fail-closed 判 L2 是这条既有触发词继续生效的
 * 原因），凑一条新触发词+挂载流程超出本文件"审批卡披露与分级"的既定范围，容易做出
 * 一个看似过了、实则没验证到真实挂载路径的假绿。这条回归改在
 * `apps/api/tests/agent-run/risk-tiering-and-states.test.ts`（issue #2767 新增的
 * describe 块）用真实 `PinnedSkillContent` 直接验证：pdf-create 中断 ⇒ 不进
 * `awaiting_tool_permission`；devapp 人类实测截图作为端到端的补充证据。
 */
