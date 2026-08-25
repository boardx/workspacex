import { test, expect } from "@playwright/test";
import {
  ACCEPTANCE_DOC,
  CHAT_READ_E2E,
  expectAnchor,
  gapMessage,
  openChatEmptyState,
  openFreshThread,
  sendAndSettle,
} from "./chat-task-workbench-fixture";

/**
 * issue #2068 —— **P1 决定能不能高效使用**（判据见 `${ACCEPTANCE_DOC}` 第四节）。
 *
 * 人类 2026-08-26 审计原话：
 * > 对话自动命名与状态管理（当前一屏全是「新对话」+「0 个 agent」，无法辨认）；
 * > 材料预加载（允许在选线程之前就加材料，当前必须先选线程）；结构化工具事件与
 * > 子 Agent 摘要；产物预览/来源/版本/导出；暂停、恢复、重试单步、检查点恢复。
 *
 * ## 当前实现（2026-08-26 勘探）
 * - **自动命名不存在**：`copilotkit-v2-shell.tsx:216` 用 `createPersonalThread(null)`，
 *   服务端 `resolveThreadId`（`agui-bridge.ts:324`）也传 `title: null`，落到
 *   `DEFAULT_PERSONAL_THREAD_TITLE = "新对话"`（`mutate-thread.ts:137`）。
 *   全仓没有 `generateTitle`/`autoTitle`。审计属实。
 * - **「0 个 agent」在 v2 轨道不成立**（分歧，如实记录）：该字面量在
 *   `chat-read-screen.tsx:702`，是旧的项目态屏。v2 空 agent 分支渲染的是
 *   `copilotkit-v2-no-agents-hint`。文案问题另由 `chat-task-workbench-copy.spec.ts`
 *   用黑名单整体覆盖，不在这里单点断言一个不存在的字面量。
 */

test.setTimeout(240_000);

test("TW-P1-1：对话自动命名——线程列表不得一屏全是「新对话」", async ({ page }) => {
  await openFreshThread(page);
  await sendAndSettle(page, "帮我调研一下国内协同白板产品的竞品格局");

  const title = await expectAnchor(
    page,
    "chat-task-workbench-thread-title",
    "TW-P1-1",
    "线程标题没有可判定的锚点，也没有自动命名能力",
    30_000,
  );

  const text = (await title.innerText()).trim();
  expect(
    text,
    [
      "【差距 TW-P1-1】发过实质内容之后线程仍叫「新对话」——没有自动命名。",
      "审计原话：当前一屏全是「新对话」，无法辨认。",
      "后端现状：createPersonalThread(null) → DEFAULT_PERSONAL_THREAD_TITLE，",
      "全仓无 generateTitle/autoTitle，需新建该能力。",
      `判据见 ${ACCEPTANCE_DOC} 的 TW-P1-1。`,
    ].join("\n"),
  ).not.toBe("新对话");
});

test("TW-P1-2：材料预加载——选线程之前就能加材料", async ({ page }) => {
  await openChatEmptyState(page);

  // 关键：**不点** chat-thread-create，停在空状态就要能拖材料进来。
  await expectAnchor(
    page,
    "chat-task-workbench-preattach-dropzone",
    "TW-P1-2",
    "未选线程时无法预加载材料（当前 chat-attachment-input 需要先有线程才可用）",
    30_000,
  );

  await page.getByTestId("chat-attachment-file-input").setInputFiles({
    name: "preattach-fixture.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("issue #2068 材料预加载取证。", "utf8"),
  });
  await expect(
    page.getByTestId("chat-attachment-count"),
    gapMessage("TW-P1-2", "chat-task-workbench-preattach-dropzone", "预加载的材料没有被真正接住"),
  ).toBeVisible({ timeout: 30_000 });
});

test("TW-P1-3：结构化工具事件与子 Agent 摘要在刷新后仍在（持久化侧）", async ({ page }) => {
  await openFreshThread(page);
  await sendAndSettle(page, CHAT_READ_E2E.deepAgentMultiStepTrigger);

  await expect(
    page.getByTestId("chat-task-workbench-event-row").first(),
    gapMessage("TW-P1-3", "chat-task-workbench-event-row", "没有结构化事件行"),
  ).toBeVisible({ timeout: 60_000 });

  await page.reload();
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible({ timeout: 120_000 });
  await expect(
    page.getByTestId("chat-task-workbench-event-row").first(),
    [
      "【差距 TW-P1-3】刷新后结构化事件与子 Agent 摘要没了。",
      "过程只活在内存里 = 用户第二天回来看不到自己昨天让 agent 做了什么。",
      `判据见 ${ACCEPTANCE_DOC} 的 TW-P1-3。`,
    ].join("\n"),
  ).toBeVisible({ timeout: 60_000 });
});

test("TW-P1-4：产物四件齐（预览 / 来源 / 版本 / 导出）", async ({ page }) => {
  await openFreshThread(page);
  await sendAndSettle(page, CHAT_READ_E2E.deepAgentMultiStepTrigger);

  for (const [suffix, what] of [
    ["preview", "预览"],
    ["sources", "来源"],
    ["versions", "版本"],
    ["export", "导出"],
  ] as const) {
    await expectAnchor(
      page,
      `chat-task-workbench-artifact-${suffix}`,
      "TW-P1-4",
      `产物缺少${what}（当前 chat-artifacts-panel 只是一个平铺列表）`,
      30_000,
    );
  }
});

test("TW-P1-5：暂停 / 恢复 / 重试单步 / 检查点恢复四个控制动作真实可点", async ({ page }) => {
  await openFreshThread(page);
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentMultiStepTrigger);
  await page.getByTestId("copilotkit-v2-send").click();

  const pause = await expectAnchor(page, "chat-task-workbench-run-pause", "TW-P1-5", "运行中不能暂停", 60_000);
  await pause.click();
  await expectAnchor(page, "chat-task-workbench-run-resume", "TW-P1-5", "暂停后不能恢复", 20_000);

  await expectAnchor(page, "chat-task-workbench-failure-retry-step", "TW-P1-5", "不能重试单步", 20_000);
  await expectAnchor(page, "chat-task-workbench-failure-restore-checkpoint", "TW-P1-5", "不能恢复到检查点", 20_000);
});
