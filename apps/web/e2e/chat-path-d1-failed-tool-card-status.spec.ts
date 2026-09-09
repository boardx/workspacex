import { expect, test, type Locator, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { expectAssistantTurnSettled, openFreshDeepAgentThread } from "./support/chat-path-coverage";

/**
 * 路径矩阵 **D1 · 工具卡片渲染**——补的是「走到终态」里**失败**那一态。
 *
 * ## 被测缺陷：失败的工具卡发绿色对勾（issue #3204 ①）
 *
 * 「这次工具调用成没成」在这条链上被算了两遍，算的不是同一件事：
 *   · **外层折叠行**：`TraceEntry.status` ← 执行日志的 `tool_end.ok`（权威事实）；
 *   · **内层工具卡**：`@copilotkit/react-core` 的三态 `inProgress | executing | complete`
 *     ——**根本没有失败**。框架只看"有没有 toolMessage"，有就判 `Complete`。
 * 于是"失败"这件事在 `render()` 边界上被丢掉、又被重新发明成"成功"：同一屏上外层写
 * 「执行工具操作失败」+ 红色感叹号，内层却是绿色对勾。
 *
 * 修法（`lib/chat-workbench/tool-outcome.ts`）是收敛成一处：轨迹面板把权威状态经
 * `JournalToolOutcomeContext` 下发，工具卡拿得到它时一律以它为准。
 *
 * ## 为什么现在才有这条 e2e
 *
 * 逐条查过既有三条相关 spec，**没有一条断言过失败态**：
 *   · `copilotkit-v2-tool-rendering.spec.ts` —— 只断言卡片渲染出来、含查询词，以及
 *     折叠/展开/刷新回放；`data-tool-status` 一次都没出现；
 *   · `chat-task-workbench-tool-events.spec.ts` —— 断言的是措辞不泄露原始工具名/JSON、
 *     子代理树展开可见四件事，与成败无关；
 *   · `chat-trace-disclosure-geometry.spec.ts` —— 静态夹具量几何，`renderTool` 传的是
 *     **手写替身卡**（`fixtures/trace-disclosure-fixture.tsx`），真实工具卡与
 *     `useToolCardStatus` 在那里根本没跑。
 *
 * 也没有任何 `LOOPBACK_*` 旋钮能让**一次工具调用**失败：既有的
 * `deepAgentFailureTrigger` 推的是整条 run 的终态（`MODEL_CALL_FAILED`），一次
 * `tool_call` 步骤都不会落地——用它写出来的用例证不了这条判据。所以本轮给确定性替身
 * 加了 `deepAgentToolFailureTrigger`：run **正常收尾**，只有其中一次调用的 ToolMessage
 * 带 `status: "error"`（正是 `deep-agent-model-provider.ts` 读的
 * `ok: message.status !== "error"` 那个字段）。
 *
 * ## 同一轮里成功与失败各一次
 *
 * 只有失败一次的剧本里，「卡片正确区分成败」与「卡片把所有调用都显示成失败」在断言侧
 * 分不开。两次都断言，才是真的在判"区分"。
 */
test.setTimeout(240_000);

const TRIGGER = CHAT_READ_E2E.deepAgentToolFailureTrigger;
const FAIL_TEXT = CHAT_READ_E2E.deepAgentToolFailureMessage;

async function runFailingToolTurn(page: Page): Promise<void> {
  await openFreshDeepAgentThread(page);
  await page.getByTestId("copilotkit-v2-input").fill(TRIGGER);
  await page.getByTestId("copilotkit-v2-send").click();
  await expectAssistantTurnSettled(page, 180_000);
}

/** 展开执行轨迹（默认折叠——那是 D2 的判据，这里只是前置，不重复断言它）。 */
async function expandRunTrace(page: Page): Promise<Locator> {
  const toggle = page.getByTestId("run-trace-toggle").last();
  await expect(toggle).toBeVisible({ timeout: 60_000 });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  const body = page.getByTestId("run-trace-body").last();
  await expect(body).toBeVisible({ timeout: 30_000 });
  return body;
}

test("@path:D1 执行轨迹里失败的工具调用：外层与内层工具卡都说失败，没有绿勾", async ({ page }) => {
  await runFailingToolTurn(page);
  const body = await expandRunTrace(page);

  // ── 前置：这一轮真的既有失败一步、也有成功一步（判据要判的是「区分」）─────────
  const failedRow = body.locator('[data-testid="run-trace-entry"][data-status="failed"]');
  const okRow = body.locator('[data-testid="run-trace-entry"][data-status="succeeded"]');
  await expect(
    failedRow,
    "这一轮应恰有一步失败。0 步 = 替身没让那次调用真的失败（`status: \"error\"` 没到），"
    + "判据无从判起；≥2 步 = 剧本变了，断言方要跟着改",
  ).toHaveCount(1, { timeout: 60_000 });
  await expect(okRow, "同一轮里必须还有成功的一步，否则「区分成败」与「一律判失败」分不开").toHaveCount(1);

  // ── 判据①：失败那一行里的**工具卡**也说失败（同一语义值两处必须恒等）──────────
  const failedCard = failedRow.locator('[data-testid="copilotkit-v2-tool-generic"]');
  await expect(
    failedCard,
    "失败那一行里应该渲染出工具卡——没有卡片就没有「内外不一致」可判",
  ).toHaveCount(1, { timeout: 30_000 });
  await expect(
    failedCard,
    "外层折叠行已判失败，内层工具卡必须同样是 failed。写着 complete 正是 #3204 ① 那条"
    + "「外层红色感叹号 + 内层绿色对勾」——框架三态里没有失败态，失败在 render 边界上"
    + "被丢掉又被重新发明成成功",
  ).toHaveAttribute("data-tool-status", "failed");
  await expect(
    failedCard.locator('[aria-label="失败"]'),
    "失败卡必须带失败图标——`data-tool-status` 是给断言看的，图标才是用户看见的那一半，"
    + "两者缺一都算没到位",
  ).toHaveCount(1);

  // ── 判据②：失败的原因对用户可读（失败可诊断性，不只是"标红了"）────────────────
  await expect(
    failedCard,
    "失败卡里要能看到这次调用失败的实际原因，否则用户只知道红了、不知道红在哪",
  ).toContainText(FAIL_TEXT);

  // ── 判据③：成功那一行没有被连坐 ────────────────────────────────────────
  await expect(
    okRow.locator('[data-testid="copilotkit-v2-tool-generic"]'),
    "成功那一步的卡片必须仍是 complete——把所有调用一律标成失败同样是内外不一致",
  ).toHaveAttribute("data-tool-status", "complete");
  await expect(okRow.locator('[aria-label="失败"]')).toHaveCount(0);
});

/**
 * 实时消息流里的那张卡——**同一个缺陷尚未收口的另一半**。
 *
 * `useToolCardStatus` 只在拿得到 `JournalToolOutcomeContext` 时才用权威状态，而那个
 * context 只由轨迹面板（`workbench/task-timeline.tsx`）下发。实时消息流里的工具卡
 * （`copilotkit-v2-assistant-message.tsx` 的 `copilotkit-v2-tool-calls-group`）拿到的是
 * `null`，于是**回落到框架三态**——那里没有失败态，失败的调用照样发绿色对勾。
 *
 * `tool-outcome.ts` 的头注把这条回落写成「"没有事实可用"的缺省」。但这一轮里事实是有的：
 * 同一屏的轨迹面板正拿着它。**用户在消息流里先看到的就是那张绿勾卡**，展开轨迹才看到红的
 * ——两处对同一次调用给出相反的结论，这正是 #3204 ① 要收敛掉的那个形状，只是收敛只做了
 * 一半。
 *
 * 处置同 C2：`test.fixme`（不删断言、不改宽、不 `test.skip`），阻塞于 **#3257**；
 * 修好后把 `fixme` 改回 `test`，正文一个字不用动。
 */
test.fixme("@path:D1 实时消息流里失败的工具调用同样不得显示成功（阻塞于 #3257）", async ({ page }) => {
  await runFailingToolTurn(page);

  const group = page.getByTestId("copilotkit-v2-tool-calls-group").last();
  await expect(group).toBeVisible({ timeout: 60_000 });
  const toggle = group.getByTestId("copilotkit-v2-tool-calls-group-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();

  const cards = group.getByTestId("copilotkit-v2-tool-generic");
  const failedCard = cards.filter({ hasText: FAIL_TEXT });
  await expect(
    failedCard,
    "消息流里应能找到那次失败调用的卡片（按它的失败原因正文定位，不按序号——"
    + "序号会随剧本调整漂移）",
  ).toHaveCount(1, { timeout: 30_000 });
  await expect(
    failedCard,
    "同一次调用，轨迹面板里是 failed，消息流里也必须是 failed。这里写着 complete = "
    + "同一屏上两处对同一件事给出相反结论，用户先看到的恰恰是错的那一处",
  ).toHaveAttribute("data-tool-status", "failed");
});
