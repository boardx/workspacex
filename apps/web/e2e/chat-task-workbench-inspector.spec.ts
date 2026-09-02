import { test, expect } from "@playwright/test";
import {
  ACCEPTANCE_DOC,
  CHAT_READ_E2E,
  expectAnchor,
  gapMessage,
  openFreshThread
} from "./chat-task-workbench-fixture";

/**
 * issue #2068 —— **TW-P0-4 右栏动态 Inspector**（判据见 `${ACCEPTANCE_DOC}`）。
 *
 * 人类 2026-08-26 审计原话：
 * > 右栏改为动态 Inspector：进度 / 材料 / 产物 / 运行详情 四页签，按任务阶段自动
 * > 切换；无内容时折叠，上传材料时开「材料」，运行时开「进度」，出结果时开「产物」。
 * > 不许常驻占六分之一屏。
 *
 * ## 当前实现（2026-08-26 勘探，`copilotkit-v2-shell.tsx:349-374`）
 * `copilotkit-v2-right-panel` 是一个**固定两段竖直堆叠**（产物在上、材料在下），
 * **没有页签**、没有「进度」、没有「运行详情」、不会按阶段切换、空态也常驻占屏。
 */

test.setTimeout(240_000);

const TABS = [
  { suffix: "progress", what: "「进度」" },
  { suffix: "materials", what: "「材料」" },
  { suffix: "artifacts", what: "「产物」" },
  { suffix: "run-details", what: "「运行详情」" },
];

test("TW-P0-4①：右栏是四页签 Inspector（进度 / 材料 / 产物 / 运行详情）", async ({ page }) => {
  await openFreshThread(page);

  await expectAnchor(
    page,
    "chat-task-workbench-inspector",
    "TW-P0-4①",
    "右栏不是动态 Inspector（当前是 copilotkit-v2-right-panel 固定两段堆叠，无页签）",
    30_000,
  );

  for (const tab of TABS) {
    await expectAnchor(
      page,
      `chat-task-workbench-inspector-tab-${tab.suffix}`,
      "TW-P0-4①",
      `Inspector 缺少${tab.what}页签`,
      15_000,
    );
  }

  // 页签必须是真 tab 语义，键盘与屏幕阅读器才认（与 TW-A11Y-8 同源）。
  await expect(
    page.getByTestId("chat-task-workbench-inspector-tab-progress"),
    gapMessage("TW-P0-4①", "chat-task-workbench-inspector-tab-progress", "页签没有 tab 角色语义"),
  ).toHaveAttribute("role", "tab");
});

test("TW-P0-4②：按任务阶段自动切换（上传材料→材料；运行中→进度；出产物→产物）", async ({ page }) => {
  const threadId = await openFreshThread(page);
  const inspector = page.getByTestId("chat-task-workbench-inspector");
  await expect(
    inspector,
    gapMessage("TW-P0-4②", "chat-task-workbench-inspector", "右栏不是动态 Inspector，谈不上自动切换"),
  ).toBeVisible({ timeout: 30_000 });

  /* ── 上传材料 → 自动开「材料」 ── */
  const attachButton = page.getByTestId("chat-attachment-input");
  await expect.poll(async () => attachButton.isDisabled(), { timeout: 20_000 }).toBe(false);
  await attachButton.click();
  await page.getByTestId("chat-attachment-file-input").setInputFiles({
    name: `inspector-autoswitch-${threadId}.txt`,
    mimeType: "text/plain",
    buffer: Buffer.from("issue #2068 Inspector 自动切换取证附件。", "utf8"),
  });
  await page.getByTestId("chat-attach-material-confirm").click();
  await expect(
    inspector,
    gapMessage("TW-P0-4②", "chat-task-workbench-inspector", "上传材料后 Inspector 没有自动切到「材料」页签"),
  ).toHaveAttribute("data-active-tab", "materials", { timeout: 30_000 });

  /* ── 运行中 → 自动开「进度」 ── */
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentMultiStepTrigger);
  await page.getByTestId("copilotkit-v2-send").click();
  await expect(
    inspector,
    gapMessage("TW-P0-4②", "chat-task-workbench-inspector", "运行中 Inspector 没有自动切到「进度」页签"),
  ).toHaveAttribute("data-active-tab", "progress", { timeout: 60_000 });

  /* ── 出产物 → 自动开「产物」 ── */
  await expect(page.getByTestId("copilotkit-v2-running-indicator")).toHaveCount(0, { timeout: 120_000 });
  await expect(
    inspector,
    gapMessage("TW-P0-4②", "chat-task-workbench-inspector", "产出结果后 Inspector 没有自动切到「产物」页签"),
  ).toHaveAttribute("data-active-tab", "artifacts", { timeout: 30_000 });
});

test("TW-P0-4③：无内容时折叠，不常驻占六分之一屏", async ({ page }) => {
  await openFreshThread(page);

  const inspector = page.getByTestId("chat-task-workbench-inspector");
  await expect(
    inspector,
    gapMessage("TW-P0-4③", "chat-task-workbench-inspector", "右栏不是可折叠的动态 Inspector"),
  ).toBeVisible({ timeout: 30_000 });

  // 新对话空状态 = 三个页签都没内容 → 应处于折叠态。
  await expect(
    inspector,
    gapMessage("TW-P0-4③", "chat-task-workbench-inspector", "空状态下右栏没有折叠（常驻占屏）"),
  ).toHaveAttribute("data-collapsed", "true");

  // 机械测量：折叠态实际占宽不得超过视口的 1/12。
  const viewport = page.viewportSize();
  expect(viewport, "需要固定视口才能机械测量占屏比例").toBeTruthy();
  const box = await inspector.boundingBox();
  expect(box, "Inspector 应可测量").toBeTruthy();
  expect(
    (box as { width: number }).width,
    [
      `【差距 TW-P0-4③】折叠态右栏仍占 ${(box as { width: number }).width}px，`,
      `超过视口宽 ${(viewport as { width: number }).width}px 的 1/12。`,
      "审计原话：不许常驻占六分之一屏。",
      `判据见 ${ACCEPTANCE_DOC} 的 TW-P0-4 一节。`,
    ].join("\n"),
  ).toBeLessThanOrEqual((viewport as { width: number }).width / 12);
});
