/**
 * 5 点迭代要求第②条（人类原话，见 `AGENTS.md`）：「你需要在前端的 chat 来测试，看如何
 * 基于上下文生成可视化」——真实生产 chat（不是后台「chat 模拟」弹窗）在真实一轮对话里
 * 拿到 `buildCanvasTemplateGuidance` 注入的指引后，模型是否真的产出可解析的 `canvas`
 * 围栏，前端是否真的把它渲染成 `ChatCanvasFabric`。
 *
 * 覆盖矩阵 **C1 · 画布围栏渲染**（判据的唯一事实源：
 * `.harness/instructions/chat-path-coverage-matrix.md`）。
 *
 * ## issue #3080：这条用例为什么曾经整个文件是 `test.fixme`，以及为什么现在恢复了
 *
 * #3035（旧屏锚点迁 v2）把本文件整条 `test` 降成 `test.fixme`，理由记在那份 PR 里：
 * 「深链进一条**种好历史**的线程」与「切到确定性回显 agent」在 v2 上互斥（#3028：
 * `copilotkit-v2-panel.tsx` 的 `key={selectedAgentId}`，切 agent 会卸载当前对话并开
 * 一条新的）。
 *
 * 那条理由对 A3（真的需要种好的历史）成立，**对本用例不成立**：画布指引只依赖
 * 「组织有已发布模板」+「用户正文里带哨兵」，与线程是谁、线程里有没有历史**无关**
 * ——本文件自己的头注一直这么写着。同一条链路上的 C4
 * （`chat-path-c4-two-canvases-one-turn.spec.ts`，一轮两个围栏）正是用「新建线程 +
 * 切回显 agent」这条路跑绿的，而它对上游那一段的要求比本用例**更强**（要一轮两个围栏
 * 且互不覆盖）。即：#3028 从来不是 C1 的阻塞项，本文件停放的是**过期的旧屏锚点**
 * （`/login` 后直接深链 + `chat-message-submit` + 等 `POST /chat/threads/:id/messages`
 * 的 202），不是缺一条产品能力。#3080 报的「矩阵说已覆盖、文件里零个 `test()`」因此
 * 是**测试侧**的债，本次按 C4 的既有做法迁锚点并恢复真实 `test()`。
 *
 * ## 与 `canvas-template-simulate-smoke.spec.ts` 验的是两件不同的事
 *
 * 那条走后台专用的只读端点 `POST /canvas/templates/:key/simulate`，完全不经过
 * `execute-run.ts`/`buildCanvasTemplateGuidance` 这条真实 agent-run 注入链路——两条链路
 * 在生产代码里不共享执行路径，那条绿不能替这条作证，见该文件文件头。
 *
 * ## 与 C4 验的也是两件不同的事
 *
 * C4 读的是**落库正文**（两个围栏、内容互不相同），因为 fabric 位图里没有可断言的文本；
 * 它对「围栏能不能被用户打开、编辑、存回去」一个字都没说。本用例补的正是这一段：
 * `data-template-source="org-generated"`（真实从库里读出的组织自建模板，不是内置 19 个
 * key 的写死几何兜底，issue #2221 治理的同一条判定路径）、点开最大化进
 * `canvas-stage.tsx` 编辑器、存回去后从 `chat-canvas-saved-source` 把围栏源读出来逐项
 * 核对。两条都在，C1 与 C4 才各自成立。
 *
 * ## 「回显即证明」——不是手填假数据
 *
 * 发的消息正文里嵌一个本用例专属的证明串（不与本夹具其余任何用例的文本重叠）。确定性
 * 上游（`loopback-model-provider.ts` 的 `canvasGuidanceReachedModel`）只在自己收到的
 * **system prompt** 里真的看到 `CANVAS_GUIDANCE_HEADER` + 本组织已发布模板的 key 时，
 * 才把这条消息的原文回显进 canvas 围栏的表头字段与分区要点——链上任何一环断掉（指引没
 * 注入、模型没看到、前端没解析、没渲染成 `ChatCanvasFabric`），证明串都不会在保存的
 * 围栏源里出现，断言如实红。
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import {
  openFreshEchoAgentThread,
  sendInV2AndAwaitStoredReply,
} from "./support/chat-path-coverage";

/**
 * issue #2295 —— 证明串**必须**带上 `CHAT_READ_E2E.canvasGuidanceSentinel`：这是
 * `loopback-model-provider.ts` 的 `canvasGuidanceReachedModel` 判定这条请求确实要走
 * 画布分支的第三个信号（唯一事实源在 `chat-read-fixture.ts`），不是随手嵌进正文的
 * 装饰性代号——少了它，这条分支不会命中，会退回通用回显分支。
 *
 * ⚠ 刻意**不**带 `canvasDualSentinel`：那是 C4 的信号，带上就变成一轮两个围栏，
 *   与本用例的单围栏判据撞车。
 */
const PROOF_TEXT = `帮我记一下这次负责人信息，代号 ${CHAT_READ_E2E.canvasGuidanceSentinel}`;

/**
 * 真栈 E2E 第三轮实测踩出的坑，与前两轮同一个根因（run 落终态那一刻的软刷新窗口）：
 * `data-ready`/`data-template-source` 断言只保证围栏组件本身的 DOM 已经稳定，不保证
 * 「点一下就一定弹出弹窗」这个动作在软刷新的间隙里不会被吞——`click()` 本身不重试，
 * 一撞上那个瞬间弹窗就是没弹出来，`chat-canvas-modal` 30s 超时。同
 * `chat-diagram-save-reopen-roundtrip.spec.ts` 里 `loadAllMessagePages` 那个既有 helper
 * 一套思路：点击这个动作本身允许重试，不是只重试断言。
 */
async function clickMaximizeUntilModalVisible(canvasFence: Locator, page: Page): Promise<void> {
  const modal = page.getByTestId("chat-canvas-modal");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await canvasFence.getByTestId("chat-canvas-maximize").click();
    try {
      await expect(modal).toBeVisible({ timeout: 10_000 });
      return;
    } catch {
      // 这一次点击被软刷新吞了：再试一轮。
    }
  }
  await expect(modal).toBeVisible();
}

test("@path:C1 真实 chat 一轮对话后，模型产出的 canvas 围栏真的渲染成工作坊画布", async ({ page }) => {
  test.setTimeout(180_000);

  // 新建线程 + 切确定性回显 agent（顺序不能反，理由见 `openFreshEchoAgentThread` 头注）。
  const threadId = await openFreshEchoAgentThread(page);

  // ── 发一条自然语言消息（不是手填围栏）——「基于上下文生成可视化」验的正是这条转换 ──
  //
  // 判据是「同一条回复里三个都要有」：```canvas（真的是围栏）+ 模板 key（走的是本组织
  // 那个已发布模板，不是别的）+ `PROOF_TEXT`（内容确实随这次请求变化，不是写死的固定
  // 串）。少任何一个，通用回显分支都可能把等待提前满足——`sendInV2AndAwaitStoredReply`
  // 头注记的正是这个坑。
  await sendInV2AndAwaitStoredReply(page, threadId, PROOF_TEXT, [
    "```canvas",
    CHAT_READ_E2E.canvasTemplateKey,
    PROOF_TEXT,
  ]);

  // ── 结构性证明①：围栏真的解析成功、渲染就绪，且走的是真实组织模板（非内置兜底）──
  //
  // ⚠ 真栈 E2E 实测踩出的坑（同 `chat-diagram-save-reopen-roundtrip.spec.ts` 头注那条
  //   既有教训）：run 落终态那一刻消息流会软刷新，这条围栏对应的 DOM 节点在那一瞬间
  //   会被摘下重挂。`scrollIntoViewIfNeeded` 是**一次性动作**，不会像
  //   `expect(...).toHaveAttribute` 那样在软刷新的间隙里重试，一撞上那个瞬间就是
  //   `Element is not attached to the DOM`。先用会自动重试的属性断言等软刷新的窗口过去、
  //   DOM 稳定下来，再滚动/点击——顺序不能反。
  const canvasFence = page.locator('[data-testid="chat-canvas-fabric"]').last();
  await expect(canvasFence).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  await expect(canvasFence).toHaveAttribute("data-template-source", "org-generated");
  // 诚实失败态必须为空：没有出现「无法渲染」（否则上面 data-ready 断言本身就该已经红了，
  // 这里是双保险，防止组件在错误分支也偶然带上过期的 data-ready 属性）。
  await expect(page.getByTestId("chat-canvas-error")).toHaveCount(0);

  // ── 结构性证明②：内容确实随这次真实请求变化——打开编辑器看围栏源，含证明串 ──
  // 走到这里 DOM 已经稳定（上面的属性断言已经成功过一次），`click()` 本身也会自动把
  // 目标滚进视口，不需要再单独调用 `scrollIntoViewIfNeeded`；点击本身仍可能撞上软刷新
  // 窗口被吞，见 `clickMaximizeUntilModalVisible` 头注。
  await clickMaximizeUntilModalVisible(canvasFence, page);
  // 弹窗里的编辑器是 `canvas-stage.tsx`（拖拽版编辑器同一个组件），不是消息气泡内联
  // 预览那个只读 `chat-canvas-fabric-surface`——两者共享 fabric.js 但是两份 DOM 节点。
  await expect(page.getByTestId("canvas-fabric-surface")).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("chat-canvas-save").click();
  await expect(page.getByTestId("chat-canvas-saved")).toBeVisible({ timeout: 30_000 });
  const savedSource = await page.getByTestId("chat-canvas-saved-source").textContent();
  expect(savedSource).toContain(CHAT_READ_E2E.canvasTemplateKey);
  expect(savedSource).toContain(CHAT_READ_E2E.canvasHeaderFieldName);
  expect(savedSource).toContain(CHAT_READ_E2E.canvasSectionName);
  expect(savedSource).toContain(PROOF_TEXT);

  await page.getByTestId("chat-canvas-close").click();
  await expect(page.getByTestId("chat-canvas-modal")).toHaveCount(0);
});
