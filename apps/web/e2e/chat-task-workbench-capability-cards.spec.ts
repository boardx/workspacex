import { test, expect } from "@playwright/test";
import { ACCEPTANCE_DOC, expectAnchor, gapMessage, openChatEmptyState, openComposerMenu } from "./chat-task-workbench-fixture";

/**
 * issue #2068 —— **TW-P0-2 Agent 身份、能力与权限说明**（判据见 `${ACCEPTANCE_DOC}`）。
 *
 * 人类 2026-08-26 审计原话：
 * > 从「选择 Agent」改成「选择能力」，默认自动匹配、可展开。每张卡至少说明：
 * > 擅长什么 / 可用工具与技能 / 能读哪些材料 / 是否写文件或调外部服务 /
 * > 记忆范围（仅本对话 / 当前项目 / 长期）/ 当前状态（就绪 运行 等待审批 失败）。
 * > 模型名、middleware、LangGraph 节点等技术信息收进「运行详情」，不占主界面。
 *
 * ## 当前实现（2026-08-26 勘探）
 * `copilotkit-v2-agent-toolbar` + `chat-agent-select` 是一个**裸下拉**
 * （`chat-composer-pickers.tsx`），选项只有 agent 显示名，六项披露一项没有。
 *
 * ## 边界（不重复声明）
 * 「引擎侧到底有没有这些能力」属于 `.harness/rubrics/deepagent-capability-rubric.md`；
 * 本条只评**披露**：用户在界面上看不看得到自己授予了什么权限。
 */

test.setTimeout(180_000);

/** 技术信息黑名单：出现在主界面即判未达标（应收进「运行详情」）。 */
const TECH_LEAK_PATTERNS: RegExp[] = [
  /langgraph/i,
  /middleware/i,
  /checkpoint/i,
  /\bqwen[\w.-]*/i,
  /\bgpt-[\w.-]+/i,
  /\bclaude-[\w.-]+/i,
  /deep-agent-loopback/i,
];

test("TW-P0-2①：入口是「选择能力」且默认自动匹配、可展开", async ({ page }) => {
  await openChatEmptyState(page);
  // 2026-09-02 composer 三层结构：入口住在「+」菜单里，先展开（见 fixture `openComposerMenu`）。
  await openComposerMenu(page);

  const picker = await expectAnchor(
    page,
    "chat-task-workbench-capability-picker",
    "TW-P0-2①",
    "缺少「选择能力」入口（当前只有裸的 chat-agent-select「选择 Agent」下拉）",
    30_000,
  );

  const label = (await picker.innerText()).trim();
  expect(label, gapMessage("TW-P0-2①", "chat-task-workbench-capability-picker", "入口文案仍是 Agent 术语，未换成用户语言「能力」")).toContain("能力");

  // 「默认自动匹配」是一个可机械判定的状态：未手选时入口须自陈处于自动匹配态。
  await expect(
    picker,
    gapMessage("TW-P0-2①", "chat-task-workbench-capability-picker", "未声明默认自动匹配态（data-auto-match）"),
  ).toHaveAttribute("data-auto-match", "true");

  // 「可展开」：点开后能力卡列表真的出现。
  await picker.click();
  await expectAnchor(page, "chat-task-workbench-capability-card", "TW-P0-2①", "展开后没有能力卡列表", 20_000);
});

test("TW-P0-2②：每张能力卡披露六项（擅长/工具技能/可读材料/写权限/记忆范围/当前状态）", async ({ page }) => {
  await openChatEmptyState(page);
  await openComposerMenu(page);
  await expectAnchor(page, "chat-task-workbench-capability-picker", "TW-P0-2②", "缺少「选择能力」入口", 30_000);
  await page.getByTestId("chat-task-workbench-capability-picker").click();

  const card = page.getByTestId("chat-task-workbench-capability-card").first();
  await expect(card, gapMessage("TW-P0-2②", "chat-task-workbench-capability-card", "展开后没有能力卡")).toBeVisible({ timeout: 20_000 });

  const facets = [
    { suffix: "strengths", what: "「擅长什么」" },
    { suffix: "tools", what: "「可用工具与技能」" },
    { suffix: "materials", what: "「能读哪些材料」" },
    { suffix: "writes", what: "「是否写文件或调外部服务」" },
    { suffix: "memory", what: "「记忆范围（仅本对话/当前项目/长期）」" },
    { suffix: "status", what: "「当前状态（就绪/运行/等待审批/失败）」" },
  ];

  for (const facet of facets) {
    const testId = `chat-task-workbench-capability-facet-${facet.suffix}`;
    await expect(
      card.getByTestId(testId),
      gapMessage("TW-P0-2②", testId, `能力卡未披露${facet.what}`),
    ).toBeVisible({ timeout: 10_000 });
  }

  // 记忆范围必须是三选一的枚举，不是自由文本——否则「长期记忆」这件事在界面上
  // 无法被用户可靠判断（这正是权限披露的意义）。
  await expect(
    card.getByTestId("chat-task-workbench-capability-facet-memory"),
    gapMessage("TW-P0-2②", "chat-task-workbench-capability-facet-memory", "记忆范围不是可判定的枚举值"),
  ).toHaveAttribute("data-memory-scope", /^(thread|project|long-term)$/);

  // 当前状态同理：四态枚举。
  await expect(
    card.getByTestId("chat-task-workbench-capability-facet-status"),
    gapMessage("TW-P0-2②", "chat-task-workbench-capability-facet-status", "当前状态不是可判定的四态枚举"),
  ).toHaveAttribute("data-status", /^(ready|running|awaiting-approval|failed)$/);
});

test("TW-P0-2③：模型名 / middleware / LangGraph 节点等技术信息不出现在主界面", async ({ page }) => {
  await openChatEmptyState(page);

  // 主界面 = composer 所在的中央工作区（不含「运行详情」抽屉，那里本来就该放技术信息）。
  // 2026-09-02 起读整张 composer 卡片（含状态 chip / 禁用理由），比此前只读 agent 工具栏更宽。
  const mainSurface = page.getByTestId("chat-task-workbench-composer");
  await expect(mainSurface).toBeVisible({ timeout: 30_000 });
  const surfaceText = await mainSurface.innerText();

  for (const pattern of TECH_LEAK_PATTERNS) {
    expect(
      surfaceText,
      [
        `【差距 TW-P0-2③】主界面泄漏技术信息，命中 ${pattern}`,
        "这类信息应收进「运行详情」页签（锚点待实现为 data-testid=chat-task-workbench-inspector-tab-run-details）",
        `判据见 ${ACCEPTANCE_DOC} 的 TW-P0-2 一节。`,
      ].join("\n"),
    ).not.toMatch(pattern);
  }
});
