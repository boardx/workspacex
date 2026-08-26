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
 * issue #2068 —— **TW-P0-7 工具与子 Agent 事件**（判据见 `${ACCEPTANCE_DOC}`）。
 *
 * 人类 2026-08-26 审计原话：
 * > 只展示可审计事件（「研究 Agent 正在检索 8 个来源」「数据 Agent 已分析 2430 行」
 * > 「已生成 市场分析报告.docx」「写入失败：目标文件无权限」），不暴露隐藏思维链；
 * > 子 Agent 用可折叠树，默认摘要、展开看输入/工具/耗时/结果。
 *
 * ## 边界（同一事实不得声明在两处）
 * - 工具调用终态是否可见 → `chat-ux-acceptance-criteria.md` 第 3 项 /
 *   `deepagent-capability-rubric.md` D2。**本 spec 不评「可见性」**。
 * - 本 spec 只评两件原三卡都没有的事：**事件措辞是否面向用户**、
 *   **子 agent 是否成可折叠树**。
 * - 「正在调用中」进行中态：人类 2026-08-10 已裁决不做（路径 B），本 spec 不要求。
 *
 * ## 当前实现（2026-08-26 勘探）
 * `copilotkit-v2-tool-generic` 是通配兜底卡，带 `data-tool-name` —— 也就是**裸工具名
 * 直接印在界面上**。子 agent 完全没有树：子调用一律落进同一个通配卡。
 * （可折叠的 `agent-tool-chain` 只存在于旧轨道，v2 panel 没有引用它。）
 */

test.setTimeout(240_000);

/** 面向用户的事件行里**不该**出现的东西：裸工具名、裸 JSON、裸枚举。 */
const DEVELOPER_ARTEFACT_PATTERNS: RegExp[] = [
  /\bwrite_todos\b/i,
  /\bsearch_documents\b/i,
  /\bls\b\(|\bread_file\b|\bwrite_file\b|\bedit_file\b/i,
  /\{\s*"[a-z_]+"\s*:/i, // 裸 JSON 对象
  /\b(succeeded|failed|in_progress|pending)\b/, // 裸状态枚举（应译成中文用户语言）
];

test("TW-P0-7①：事件行措辞面向用户，不印裸工具名 / 裸 JSON / 裸枚举", async ({ page }) => {
  await openFreshThread(page);
  await sendAndSettle(page, CHAT_READ_E2E.deepAgentMultiStepTrigger);

  const rows = page.getByTestId("chat-task-workbench-event-row");
  await expect(
    rows.first(),
    gapMessage(
      "TW-P0-7①",
      "chat-task-workbench-event-row",
      "没有面向用户的可审计事件行（当前是 copilotkit-v2-tool-generic 通配卡，data-tool-name 直接印裸工具名）",
    ),
  ).toBeVisible({ timeout: 60_000 });

  const texts = await rows.allInnerTexts();
  for (const text of texts) {
    for (const pattern of DEVELOPER_ARTEFACT_PATTERNS) {
      expect(
        text,
        [
          `【差距 TW-P0-7①】事件行含开发者词汇，命中 ${pattern}`,
          `原文：${text.slice(0, 160)}`,
          "审计要求的措辞形如「研究 Agent 正在检索 8 个来源」「已生成 市场分析报告.docx」。",
          `判据见 ${ACCEPTANCE_DOC} 的 TW-P0-7 一节。`,
        ].join("\n"),
      ).not.toMatch(pattern);
    }
  }
});

test("TW-P0-7②：不暴露隐藏思维链", async ({ page }) => {
  await openFreshThread(page);
  await sendAndSettle(page, CHAT_READ_E2E.deepAgentMultiStepTrigger);

  const surface = page.getByTestId("copilotkit-v2-messages");
  await expect(surface).toBeVisible({ timeout: 30_000 });

  // 思维链原文一旦被渲染，会以这些容器/标记出现。界面上不该有。
  for (const selector of ['[data-role="reasoning"]', '[data-role="thinking"]', "[data-reasoning-text]"]) {
    expect(
      await surface.locator(selector).count(),
      [
        `【差距 TW-P0-7②】界面渲染了隐藏思维链原文（${selector}）。`,
        "审计原话：只展示可审计事件，不暴露隐藏思维链。",
        `判据见 ${ACCEPTANCE_DOC} 的 TW-P0-7 一节。`,
      ].join("\n"),
    ).toBe(0);
  }
});

test("TW-P0-7③：子 Agent 是可折叠树，默认摘要，展开看输入/工具/耗时/结果", async ({ page }) => {
  await openFreshThread(page);
  await sendAndSettle(page, CHAT_READ_E2E.deepAgentMultiStepTrigger);

  const node = await expectAnchor(
    page,
    "chat-task-workbench-subagent-node",
    "TW-P0-7③",
    "没有子 Agent 折叠树（v2 轨道里子调用一律落进 copilotkit-v2-tool-generic 通配卡）",
    60_000,
  );

  // 默认摘要态。
  await expect(
    node,
    gapMessage("TW-P0-7③", "chat-task-workbench-subagent-node", "子 Agent 节点默认不是折叠的摘要态"),
  ).toHaveAttribute("aria-expanded", "false");

  await node.click();
  await expect(node).toHaveAttribute("aria-expanded", "true", { timeout: 10_000 });

  for (const [suffix, what] of [
    ["input", "输入"],
    ["tools", "用了哪些工具"],
    ["duration", "耗时"],
    ["result", "结果"],
  ] as const) {
    const testId = `chat-task-workbench-subagent-detail-${suffix}`;
    await expect(
      page.getByTestId(testId),
      gapMessage("TW-P0-7③", testId, `子 Agent 展开后看不到${what}`),
    ).toBeVisible({ timeout: 10_000 });
  }
});
