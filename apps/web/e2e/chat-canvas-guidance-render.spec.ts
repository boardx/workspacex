/**
 * 5 点迭代要求第②条（人类原话，见 `AGENTS.md`）：「你需要在前端的 chat 来测试，看如何
 * 基于上下文生成可视化」——真实生产 chat（不是后台「chat 模拟」弹窗）在真实一轮对话里
 * 拿到 `buildCanvasTemplateGuidance` 注入的指引后，模型是否真的产出可解析的 `canvas`
 * 围栏，前端是否真的把它渲染成 `ChatCanvasFabric`。
 *
 * ## 与 `canvas-template-simulate-smoke.spec.ts` 验的是两件不同的事
 *
 * 那条走后台专用的只读端点 `POST /canvas/templates/:key/simulate`，完全不经过
 * `execute-run.ts`/`buildCanvasTemplateGuidance` 这条真实 agent-run 注入链路——两条链路
 * 在生产代码里不共享执行路径，那条绿不能替这条作证，见该文件文件头。
 *
 * ## 「回显即证明」——不是手填假数据
 *
 * 发的消息正文里嵌一个本用例专属的证明串（不与本夹具其余任何用例的文本重叠）。确定性
 * 上游（`loopback-model-provider.ts` 的 `canvasGuidanceReachedModel`）只在自己收到的
 * **system prompt** 里真的看到 `CANVAS_GUIDANCE_HEADER` + 本组织已发布模板的 key 时，
 * 才把这条消息的原文回显进 canvas 围栏的表头字段与分区要点——链上任何一环断掉（指引没
 * 注入、模型没看到、前端没解析、没渲染成 `ChatCanvasFabric`），证明串都不会在保存的
 * 围栏源里出现，断言如实红。
 *
 * `data-template-source="org-generated"`（`ensureCanvasFenceTemplate`，issue #2221 治理
 * 的同一条判定路径）额外证明这条渲染走的是真实从库里读出的组织自建模板，不是内置 19
 * 个 key 的写死几何兜底——呼应 5 点要求第④条「任何组织都可以使用这个能力」：本用例的
 * 组织不是任何特殊组织，模板也不是内置模板，key 不在 `BUILTIN_CANVAS_TEMPLATES` 里。
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { V2_SEND_WIRE, awaitAssistantReply, bearerOf, snapshotMessageIds } from "./chat-v2-send";

/**
 * issue #2295 —— 证明串**必须**带上 `CHAT_READ_E2E.canvasGuidanceSentinel`：这是
 * `loopback-model-provider.ts` 的 `canvasGuidanceReachedModel` 判定这条请求确实来自
 * 本专属线程的第三个信号（唯一事实源在 `chat-read-fixture.ts`），不是随手嵌进正文的
 * 装饰性代号——少了它，这条分支不会命中，会退回通用回显分支。
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

test("真实 chat 一轮对话后，模型产出的 canvas 围栏真的渲染成工作坊画布", async ({ page }) => {
  test.setTimeout(180_000);

  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto(
    `/chat?projectId=${CHAT_READ_E2E.restructureProjectId}&thread=${CHAT_READ_E2E.canvasGuidanceThreadId}`,
  );
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.canvasGuidanceThreadId}`))
    .toContainText("Canvas guidance in real chat check thread");

  const bearer = await bearerOf(page);
  const knownIds = await snapshotMessageIds(page, CHAT_READ_E2E.canvasGuidanceThreadId, bearer);

  // ── 发一条自然语言消息（不是手填围栏）——「基于上下文生成可视化」验的正是这条转换 ──
  // issue #2997 —— 锚点由旧屏迁到 v2 工作台（`#2890` 之后 `/chat?projectId=` 渲染
  // 的是 CopilotKit v2；旧屏已无可达路由）。换的只是输入框/发送按钮这两个承载物，
  // 本用例要证的「自然语言 → 模型产出 canvas 围栏 → 真的渲染成工作坊画布」一字未动：
  // 围栏渲染那一半（`chat-canvas-fabric` / `chat-canvas-modal` / `canvas-fabric-surface`）
  // 出自 `markdown-message.tsx`，而 v2 的 `assistantMessage` slot 正是渲染
  // `MarkdownMessage`（`copilotkit-v2-assistant-message.tsx`），两屏同一份实现。
  const input = page.getByTestId("copilotkit-v2-input");
  await input.fill(PROOF_TEXT);
  // issue #2997 —— v2 的发送线路见 `chat-v2-send.ts` 头注；判据从"202 被接收"
  // 换成"上行 run 请求真的带着这句提示词发了出去"，证的仍是"这一轮真的发出去了"。
  const accepted = page.waitForRequest(
    (r) => r.method() === "POST" && V2_SEND_WIRE.test(new URL(r.url()).pathname),
    { timeout: 60_000 },
  );
  await page.getByTestId("copilotkit-v2-send").click();
  expect(JSON.stringify((await accepted).postDataJSON())).toContain(PROOF_TEXT);

  // 等这条消息触发的 AgentRun 到终态。
  //
  // issue #2997 —— 原写法轮询 `GET /agent-runs/:id`，那是**旧屏**的状态源；v2 拿的
  // 是 AG-UI 事件流，整轮不发这条请求，原写法会挂死在 120s 超时上（不是变红，是等不到）。
  // 换成"这一轮真的落库了一条带 `agentRunId` 的 assistant 回复"——同样是终态信号，
  // 而且更强：它顺带证明写回事务真的提交了。理由见 `chat-v2-send.ts` 头注。
  await awaitAssistantReply(page, CHAT_READ_E2E.canvasGuidanceThreadId, bearer, knownIds, 120_000);

  // ── 结构性证明①：围栏真的解析成功、渲染就绪，且走的是真实组织模板（非内置兜底）──
  //
  // ⚠ 真栈 E2E 实测踩出的坑（同 `chat-diagram-save-reopen-roundtrip.spec.ts` 头注那条
  //   既有教训）：run 落终态那一刻，`chat-live-message-panel.tsx` 会软刷新消息流，
  //   这条围栏对应的 DOM 节点在那一瞬间会被摘下重挂。`scrollIntoViewIfNeeded` 是
  //   **一次性动作**，不会像 `expect(...).toHaveAttribute` 那样在软刷新的间隙里重试，
  //   一撞上那个瞬间就是 `Element is not attached to the DOM`。先用会自动重试的属性
  //   断言等软刷新的窗口过去、DOM 稳定下来，再滚动/点击——顺序不能反。
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
