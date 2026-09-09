import { expect, test, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import {
  expectAssistantTurnSettled,
  openFreshDeepAgentThread,
  storedMessages,
} from "./support/chat-path-coverage";

/**
 * 路径矩阵 **C1 · 画布围栏渲染**——补的是这条判据里此前**没有任何用例断言过**的那半：
 * 「渲染出来了」之后，它**活不活得过 run 收尾与刷新**。
 *
 * ## 这条用例存在的理由：两个真实缺陷，当时 C1/C4/C5 全绿
 *
 * 人类 2026-09-09 devapp 实测（issue #3243）：要求生成 10 个画布模板，**生成过程中一个
 * 一个都看见了**，run 一结束画布全部消失，刷新后一个也没有，而最后那句「所有 10 个画布
 * 模板现已完整交付」是真的——交付物确实产出过，只是从没被写进任何持久记录。
 *
 *   · **缺陷①（落库只留最后一句）**：流式把本轮**每一条**顶层 AI 消息喂给 `onDelta`
 *     （画布就是这样一个一个画出来的），落库此前只取 `readFinalReply`——**最后一条**非空
 *     AI 消息，那条恰恰是零围栏的纯文字总结。刷新读 `chat_messages` 于是什么都没有。
 *     PR #3248 把落库正文收敛成同一批消息（`readTurnReply` / `joinTurnAssistantBodies`）。
 *   · **缺陷②（收尾顶替）**：`restoreFinalMessages` 在 run 收尾时用落库正文顶替流式正文
 *     （`copilotkit-v2-panel-body.tsx` 的 `restoreJournalResult`）。落库正文里没有围栏，
 *     于是画布在 run 结束那一刻当场消失——用户看到的是「生成过程中有、跑完就没了」。
 *
 * **两个缺陷 #3248 都修了，但修它的是一条单元测试；浏览器这一层没有任何门。**
 * 本用例就是那道门。
 *
 * ## 为什么不能复用 C4/C5 的剧本
 *
 * C4（`chat-path-c4-two-canvases-one-turn`）产出的是**一条** AI 消息里并排两个围栏。
 * 缺陷①只在**一轮里有多条顶层 AI 消息**时才存在：一条消息的剧本里「每一条」与
 * 「最后一条」是同一条，`readFinalReply` 与 `readTurnReply` 给出逐字节相同的结果——
 * **判据无法被证伪**。所以本用例走 deep-agent 侧的专属剧本
 * （`deepAgentMultiCanvasTrigger`）：前 N 条 AI 消息各带一个围栏，最后一条是零围栏的
 * 纯文字总结，正是缺陷需要的那个形状。
 *
 * ## 判据是「同一语义值两处恒等」，不是「元素存在」
 *
 * 「画布出现了」对上面两个缺陷**全部恒绿**——它们都是「先出现、随后消失」。本用例钉的
 * 是同一个语义值在三个时刻/两个平面上必须相等：
 *   ① 流式期间渲染出的画布数（用户看见的）
 *   ② run 收尾之后渲染出的画布数（缺陷② 在这一步掉数）
 *   ③ 落库正文里的围栏数（缺陷① 在这一步掉成 0）
 *   ④ 整页刷新之后渲染出的画布数（缺陷① 对用户的最终形态）
 * 四个数必须全等于 N。少断言任何一个，对应的那个缺陷就会从门下走过去。
 */
test.setTimeout(240_000);

const N = CHAT_READ_E2E.deepAgentMultiCanvasCount;
const TRIGGER = CHAT_READ_E2E.deepAgentMultiCanvasTrigger;

const fabrics = (page: Page) => page.locator('[data-testid="chat-canvas-fabric"]');

/**
 * 「流式期间用户真的看见了 N 个画布」——run 还没收尾时的峰值。
 *
 * ⚠ 为什么这一步不是「等 N 秒再看一眼」那种时序赌博：围栏**闭合之后**才会被挂载
 * （issue #2298：`closed === false` 时校验整个跳过，停在 loading 态），而第 i 个围栏
 * 在第 i+1 条消息开始流的那一刻就已经闭合。最后那条纯文字总结要流完整整一段，
 * 前 N 个围栏因此**在构造上**必然先于收尾全部挂出。这里轮询取峰值，只是为了把
 * 「从没出现过」（缺陷之外的环境问题）与「出现过又消失」（缺陷②）分开——两者在
 * 一条收尾后的数量红里分不出来。
 */
async function peakCanvasCountUntilSettled(page: Page): Promise<number> {
  let peak = 0;
  let settled = false;
  const watch = (async () => {
    while (!settled) {
      peak = Math.max(peak, await fabrics(page).count().catch(() => 0));
      await page.waitForTimeout(120);
    }
  })();
  try {
    await expectAssistantTurnSettled(page, 180_000);
  } finally {
    settled = true;
    await watch;
  }
  peak = Math.max(peak, await fabrics(page).count().catch(() => 0));
  return peak;
}

/** 落库正文里的围栏数——权威读，不看渲染出来的那一帧。 */
function persistedFenceCount(texts: readonly string[]): number {
  return texts.reduce((sum, text) => sum + (text.match(/```canvas/g) ?? []).length, 0);
}

test("@path:C1 一轮分步产出多个画布：收尾不消失、落库有全部围栏、刷新后仍在", async ({ page }) => {
  const threadId = await openFreshDeepAgentThread(page);

  await page.getByTestId("copilotkit-v2-input").fill(TRIGGER);
  await page.getByTestId("copilotkit-v2-send").click();

  // ── ① 流式期间：用户真的一个一个看见了 N 个画布 ─────────────────────────
  const peak = await peakCanvasCountUntilSettled(page);
  expect(
    peak,
    `流式期间应至少同时出现 ${N} 个画布。峰值就是 0 说明这一轮压根没产出围栏——`
    + "那是环境/剧本问题，不是本用例要抓的「出现过又消失」",
  ).toBeGreaterThanOrEqual(N);

  // ── ② run 收尾之后：一个都不能少（缺陷②「收尾用落库正文顶替流式正文」）──────
  await expect(
    fabrics(page),
    `run 收尾后画布数应仍为 ${N}。掉到 0（或掉数）正是 #3243 那条「生成过程中一个一个`
    + "都看见了，run 一结束全部消失」——收尾时 `restoreFinalMessages` 用落库正文顶替了"
    + "流式正文，而落库正文里没有围栏",
  ).toHaveCount(N, { timeout: 60_000 });
  await expect(page.getByTestId("chat-canvas-error")).toHaveCount(0);

  // ── ③ 权威读：落库正文里真的有全部 N 个围栏（缺陷①「只落库最后一条」）────────
  const messages = await storedMessages(page, threadId);
  const agentTexts = messages.filter((m) => m.authorKind === "agent").map((m) => m.text);
  expect(
    persistedFenceCount(agentTexts),
    `落库正文里的围栏数应为 ${N}。为 0 = 落库只取了最后一条 AI 消息（那条是零围栏的纯`
    + "文字总结），正是 PR #3248 修的那件事；这条断言是它在浏览器这一层的回归门。\n"
    + `实际落库的 agent 正文：\n${agentTexts.map((t) => `· ${t.slice(0, 160).replace(/\n/g, "⏎")}`).join("\n") || "（一条都没有）"}`,
  ).toBe(N);
  /*
   * 顺带钉住「不是把最后一条换成了第一条」这种半修：本轮的总结句与全部围栏必须**同时**
   * 在落库正文里。只断言围栏数的版本，对「只留围栏、丢掉总结」这种反向丢失恒绿——那同样
   * 是「用户看见的」与「落库的」两处不等。
   */
  expect(
    agentTexts.some((t) => t.includes(CHAT_READ_E2E.deepAgentMultiCanvasSummary)),
    "本轮那句零围栏的总结也必须落库——它和围栏是同一轮里用户都看见过的东西，"
    + "落库正文要么两样都有，要么就不是「用户看见哪些就落库哪些」",
  ).toBe(true);

  // ── ④ 整页刷新：穿透前端内存态，看的是落库事实（缺陷①对用户的最终形态）────────
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    fabrics(page),
    `刷新后画布数应仍为 ${N}。为 0 = #3243 人类实测那句「刷新后一个也没有」`,
  ).toHaveCount(N, { timeout: 120_000 });

  // ── ⑤ 状态一致性：渲染这一侧与落库那一侧是同一个数，不是各自碰巧对 ──────────
  const afterReload = await storedMessages(page, threadId);
  expect(
    persistedFenceCount(afterReload.filter((m) => m.authorKind === "agent").map((m) => m.text)),
    "刷新后重新读一次落库正文，围栏数必须与屏幕上的画布数相等——"
    + "「同一语义值在两处必须恒等」，两边各自对不算数",
  ).toBe(await fabrics(page).count());
});
