import { expect, test } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import {
  openFreshEchoAgentThread,
  sendInV2AndAwaitStoredReply,
  storedMessages,
} from "./support/chat-path-coverage";

/**
 * 路径矩阵 **C5 · 连续多轮产物**（判据见 `.harness/instructions/chat-path-coverage-matrix.md`）。
 *
 * ## 一次成功不能证明连续可用
 *
 * 既有画布用例（`chat-canvas-guidance-render.spec.ts` / `chat-diagram-save-reopen-
 * roundtrip.spec.ts`）每条都只产**一个**产物就收尾。「连着三轮各产一个」这条路径上有
 * 一类只在第 ≥2 轮才可能出现的失效，此前零覆盖：
 *   · 第二轮的产物挂载点复用了第一轮的 key ⇒ 覆盖前一轮（用户翻回上一条，图变了）；
 *   · 每轮把此前所有产物重新挂一遍 ⇒ 数量按 1/3/6 增长（重复挂载）；
 *   · 前一轮的画布在后一轮渲染时被卸载重挂 ⇒ 闪烁。
 *
 * 判据因此是**逐轮的数量与内容对照**：第 N 轮结束时画布数恰为 N，且第 1..N 条各自
 * 仍带着**自己那一轮**的标记。只断言"最后一轮成功"对上面三种失效全部恒绿。
 *
 * ## 为什么第三轮单独断言
 *
 * 矩阵里写明"要单独测第三轮"：两轮足以暴露"覆盖"，但按 2^n / n² 增长的重复挂载在
 * 两轮时可能仍是 1→2，看不出来。三轮是能把三类失效同时区分开的最小轮数。
 */
test.setTimeout(300_000);

const TURNS = 3;

function proofFor(turn: number): string {
  return `第 ${turn} 轮请出一张图，代号 ${CHAT_READ_E2E.canvasGuidanceSentinel} 轮次标记 SERIAL-${turn}`;
}

test("@path:C5 连续三轮各产一个画布：逐轮累加、互不覆盖、不重复挂载", async ({ page }) => {
  const threadId = await openFreshEchoAgentThread(page);

  const fabrics = page.locator('[data-testid="chat-canvas-fabric"]');
  for (let turn = 1; turn <= TURNS; turn += 1) {
    await sendInV2AndAwaitStoredReply(
      page,
      threadId,
      proofFor(turn),
      `SERIAL-${turn}`,
    );

    // 线程里累计恰好 N 个：少了 = 前面的被覆盖/卸载；多了 = 重复挂载。
    await expect(
      fabrics,
      `第 ${turn} 轮结束时线程里应恰有 ${turn} 个画布：少了说明前几轮的被覆盖或卸载，`
      + "多了说明每轮把历史产物重新挂了一遍",
    ).toHaveCount(turn, { timeout: 120_000 });
    await expect(page.getByTestId("chat-canvas-error")).toHaveCount(0);
  }

  // ── 权威读：三条回复各自带着**自己那一轮**的标记，没有一条被后来的轮次改写 ──
  const messages = await storedMessages(page, threadId);
  const answers = messages.filter((message) => message.authorKind === "agent" && message.text.includes("```canvas"));
  expect(answers, "三轮应各落库一条带围栏的回复").toHaveLength(TURNS);
  for (let turn = 1; turn <= TURNS; turn += 1) {
    const owned = answers.filter((message) => message.text.includes(`SERIAL-${turn}`));
    expect(
      owned,
      `轮次标记 SERIAL-${turn} 应恰好出现在一条回复里——0 条 = 那一轮的产物被覆盖，`
      + "≥2 条 = 同一份产物被复制进了别的轮次",
    ).toHaveLength(1);
  }

  // 刷新后仍是三个：证明累加的是落库事实，不是本次会话里攒出来的 DOM。
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(fabrics).toHaveCount(TURNS, { timeout: 120_000 });
});
