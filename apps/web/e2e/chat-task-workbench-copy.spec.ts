import { test, expect } from "@playwright/test";
import { ACCEPTANCE_DOC, CHAT_READ_E2E, openChatEmptyState, openFreshThread, sendAndSettle } from "./chat-task-workbench-fixture";

/**
 * issue #2068 —— **文案（TW-COPY-1）**（判据见 `${ACCEPTANCE_DOC}` 第五节）。
 *
 * 人类 2026-08-26 审计原话：
 * > 不许暴露内部概念（「0 个 agent」「选择线程后读取」这类），换成用户语言 + 明确动作。
 *
 * ## 与既有实践的关系
 * 本仓 2026-08-23 已因同类问题合过一次修复（commit c1cead38「用户可见文案去掉开发者
 * 词汇『真实』」）——那次是**逐个手改**，没有留下门控，于是同一类问题今天又被审计
 * 抓到。本 spec 就是那道缺失的门控：把「不许暴露内部概念」从一句规范变成一个会红的
 * 断言，覆盖整个 `/chat` 可见文本，而不是某几个字符串。
 *
 * ## ⚠ 与审计原文的一处分歧（如实记录）
 * 审计点名的「0 个 agent」字面量，2026-08-26 勘探显示在 v2 轨道**不存在**：
 * 它在 `chat-read-screen.tsx:702`，属于旧的项目态屏。v2 空 agent 分支渲染的是
 * `copilotkit-v2-no-agents-hint`。因此本 spec 不去断言那个具体字面量，而是用
 * **黑名单整体扫描**——这样既覆盖了审计的意图，也不会因为一个不存在的字符串
 * 而产生假绿或假红。
 */

test.setTimeout(240_000);

/**
 * 用户可见文本里的开发者词汇黑名单。
 * 每条都必须是**用户读不懂或不该关心**的内部概念，不是「我觉得不好听」。
 */
const FORBIDDEN_COPY: { pattern: RegExp; why: string }[] = [
  { pattern: /0\s*个\s*agent/i, why: "审计点名：内部计数，用户不知道 agent 是什么单位" },
  { pattern: /选择线程后读取/, why: "审计点名：暴露了「线程」这个内部概念 + 描述的是系统行为不是用户动作" },
  { pattern: /\bthread\b/i, why: "「线程」是内部概念，用户语言是「对话」" },
  { pattern: /write_todos/i, why: "裸工具名" },
  { pattern: /langgraph/i, why: "编排框架名，属于「运行详情」" },
  { pattern: /middleware/i, why: "内部架构概念" },
  { pattern: /checkpoint_id/i, why: "内部标识符字段名" },
  { pattern: /visibilityScope/i, why: "本仓 #728 已因把裸枚举印上界面被抓过一次" },
  { pattern: /\b(succeeded|failed|in_progress|pending)\b/, why: "裸状态枚举，应译成用户语言" },
  {
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
    why: "裸 UUID 对用户没有任何意义",
  },
];

async function assertCleanCopy(page: import("@playwright/test").Page, surface: string): Promise<void> {
  const visibleText = await page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    return (main as HTMLElement).innerText ?? "";
  });

  for (const { pattern, why } of FORBIDDEN_COPY) {
    const hit = pattern.exec(visibleText);
    expect(
      hit,
      [
        `【差距 TW-COPY-1】${surface} 的用户可见文案含开发者词汇：${hit?.[0] ?? ""}`,
        `为什么不行：${why}`,
        `上下文：…${visibleText.slice(Math.max(0, (hit?.index ?? 0) - 60), (hit?.index ?? 0) + 60).replace(/\n/g, " ")}…`,
        "换成用户语言 + 明确动作。",
        `判据见 ${ACCEPTANCE_DOC} 的 TW-COPY-1。`,
      ].join("\n"),
    ).toBeNull();
  }
}

test("TW-COPY-1①：/chat 空状态不暴露内部概念", async ({ page }) => {
  await openChatEmptyState(page);
  await assertCleanCopy(page, "/chat 新对话空状态");
});

test("TW-COPY-1②：多步任务执行后，过程区文案不暴露内部概念", async ({ page }) => {
  await openFreshThread(page);
  await sendAndSettle(page, CHAT_READ_E2E.deepAgentMultiStepTrigger);
  await assertCleanCopy(page, "/chat 多步任务执行后");
});

test("TW-COPY-1③：失败态文案不暴露内部概念（失败时最容易把裸错误直接印出来）", async ({ page }) => {
  await openFreshThread(page);
  await sendAndSettle(page, CHAT_READ_E2E.deepAgentFailureTrigger);
  await assertCleanCopy(page, "/chat 失败态");
});
