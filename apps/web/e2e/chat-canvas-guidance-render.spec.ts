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
import { expect, test } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

const PROOF_TEXT = "帮我记一下这次负责人信息，代号 E2E-CANVAS-6031";

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

  // ── 发一条自然语言消息（不是手填围栏）——「基于上下文生成可视化」验的正是这条转换 ──
  const input = page.getByRole("textbox", { name: "消息内容" });
  await input.fill(PROOF_TEXT);
  const accepted = page.waitForResponse((r) =>
    r.request().method() === "POST"
    && r.url().endsWith(`/chat/threads/${CHAT_READ_E2E.canvasGuidanceThreadId}/messages`));
  await page.getByTestId("chat-message-submit").click();
  expect((await accepted).status()).toBe(202);

  // 等这条消息触发的 AgentRun 到终态——同 `chat-diagram-save-reopen-roundtrip.spec.ts`
  // 既有手法，不猜固定延时。
  await page.waitForResponse(async (r) => {
    if (r.request().method() !== "GET" || !/\/agent-runs\/[^/]+$/.test(r.url())) return false;
    try {
      const body = await r.json() as { status?: string };
      return body.status === "succeeded" || body.status === "failed";
    } catch { return false; }
  }, { timeout: 120_000 });

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
  // 目标滚进视口，不需要再单独调用 `scrollIntoViewIfNeeded`。
  await canvasFence.getByTestId("chat-canvas-maximize").click();
  const modal = page.getByTestId("chat-canvas-modal");
  await expect(modal).toBeVisible();
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
