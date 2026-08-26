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

/**
 * ## ⚠ 为什么这里断言**整个集合**，而不是 `.first()`（coord 2026-08-26 裁决）
 *
 * 这条用例原先写的是 `expectAnchor(page, "chat-task-workbench-thread-title", …)`，
 * 而 `expectAnchor` 用的是 Playwright 的**严格定位器**。`...-thread-title` 是
 * **天然复数**的锚点——每张线程卡一个。于是真栈上必然：
 *
 *     strict mode violation: getByTestId('chat-task-workbench-thread-title')
 *       resolved to 3 elements
 *
 * 它红在**第一条断言之前**，与实现是好是坏无关：**只要侧栏多于一条线程它就红**，
 * 唯一能绿的世界是「全库只有一条对话」——正好是这条判据想验的场景的反面。
 *
 * ### 修法只有一个是对的
 *
 * 遇到 `resolved to N elements` 最顺手的动作是加 `.first()`。**那是错的，别加。**
 * 判据（`${ACCEPTANCE_DOC}` 的 TW-P1-1）说的是「对话列表不得一屏全是『新对话』」
 * ——**全体**标题的性质。`.first()` 只看最上面那一张卡，于是一个
 * 「只有第一条有标题、其余全是『新对话』」的实现能通过，而**那正是人类截图里
 * 那个问题本身**。`.first()` 比判据弱，它把门改松了。
 *
 * 本仓的规矩是**收紧可以、放松要有理由**，而看起来像「修 flaky」的放松最危险：
 * 一个 `resolved to 3 elements` 看着像定位器写法问题，实际是判据与断言的粒度对不上。
 * 所以这里取全部标题、逐个判定，并把这段理由留在原地——下一个撞见它的人先读到
 * 「为什么不能加 `.first()`」，再决定动手。
 */
test("TW-P1-1：对话自动命名——线程列表不得一屏全是「新对话」", async ({ page }) => {
  await openFreshThread(page);
  await sendAndSettle(page, "帮我调研一下国内协同白板产品的竞品格局");

  const titles = page.getByTestId("chat-task-workbench-thread-title");

  // 锚点存在性单独判一次：一条都没有 = 能力不存在，与「有锚点但内容不对」是两回事，
  // 失败信息也该不一样。⚠ 用 `.first()` 仅限**这一处存在性检查**，不用于内容判定。
  await expect(
    titles.first(),
    gapMessage("TW-P1-1", "chat-task-workbench-thread-title", "线程标题没有可判定的锚点，也没有自动命名能力"),
  ).toBeVisible({ timeout: 30_000 });

  /**
   * ⚠ 判定范围是「**已经开始**的对话」，不是全部卡片。这不是放松，是两条已确认的
   * 决定合起来的**唯一自洽解**：
   *
   *   · coord 2026-08-26 裁决：按整集断言，不许 `.first()`（理由见上）。
   *   · 同一条消息里 coord 确认的空线程处置：**不发明名字**，一条没发过消息的线程
   *     如实标「还没开始」、标题保持默认。
   *
   * 若逐字断言「每一条标题都不等于默认名」，就会与第二条直接打架：一条刚建好、
   * 状态是 `not-started` 的线程**按设计就该**叫「新对话」。那样的门控会因为
   * 「实现正确地遵守了设计」而红——一个必然误报的门控会被人习惯性忽略，
   * 那比没有门控更糟。
   *
   * 而且真栈是多 worker 并行共库：别的用例随时可能刚建出一条空线程。把它算成
   * 缺陷，红的原因就成了「隔壁用例跑到哪一步」，与被测行为无关。
   *
   * 取「已开始的对话必须有真标题」既满足判据的本意（列表可辨认 —— 有内容的对话
   * 一眼认得出是哪件事），又对空线程与并行干扰免疫，且**仍然比 `.first()` 强得多**：
   * 「只有第一条有标题、其余全是新对话」这个实现在这里照样红。
   */
  const rows = await page.evaluate(() => {
    const out: { title: string; status: string }[] = [];
    document
      .querySelectorAll('[data-testid="chat-task-workbench-thread-status"]')
      .forEach((statusEl) => {
        const card = statusEl.closest("button");
        const titleEl = card?.querySelector('[data-testid="chat-task-workbench-thread-title"]');
        out.push({
          title: (titleEl as HTMLElement | null)?.innerText?.trim() ?? "",
          status: statusEl.getAttribute("data-status") ?? "",
        });
      });
    return out;
  });

  const started = rows.filter((r) => r.status !== "not-started");
  const offenders = started.filter((r) => r.title === "新对话" || r.title.length === 0);

  expect(
    started.length,
    "前置条件：刚发过一条消息，列表里至少该有一条「已开始」的对话；一条都没有说明取数或状态投影坏了",
  ).toBeGreaterThan(0);

  expect(
    offenders,
    [
      "【差距 TW-P1-1】已经开始的对话里仍有标题是「新对话」或空——自动命名没有覆盖全体。",
      "审计原话：当前一屏全是「新对话」，无法辨认。",
      `本轮实测：共 ${rows.length} 条卡片，其中 ${started.length} 条已开始，${offenders.length} 条不合格。`,
      `全部卡片（标题 / 状态）：${JSON.stringify(rows)}`,
      "⚠ 修法不是给定位器加 `.first()`——判据说的是**全体**的性质，只看第一条会让",
      "  「只有第一条有标题」的实现通过，那正是审计抓到的问题本身。",
      `判据见 ${ACCEPTANCE_DOC} 的 TW-P1-1。`,
    ].join("\n"),
  ).toEqual([]);
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
