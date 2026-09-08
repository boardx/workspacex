import { expect, test } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import {
  awaitProjectThreadReply,
  login,
  sendOnProjectThread,
  storedMessages,
} from "./support/chat-path-coverage";

/**
 * 路径矩阵 **C4 · 一次生成两个画布**（判据见 `.harness/instructions/chat-path-coverage-matrix.md`）。
 *
 * ## 一个围栏能渲染 ≠ 一轮里的两个都能
 *
 * `chat-canvas-guidance-render.spec.ts` 证的是「模型产出的 canvas 围栏真的渲染成工作坊
 * 画布」——它全程只有一个围栏，用 `.last()` 取到它。一轮里出现两个围栏时，这条链上有
 * 三个**只有在数量 > 1 时才存在**的失效点，一个都没被测过：
 *   ① 解析器只取第一个围栏（后一个被静默丢掉）；
 *   ② 两个围栏共用同一个挂载点／同一个 canvas id，后者覆盖前者（用户看到两个框、
 *      内容却是同一份）；
 *   ③ 两个都挂上了，但内容互相串（表头字段值被后一个的覆盖）。
 *
 * 这三点在 UI 上的表现都不是「报错」，是**安静地少给或给错**——所以断言必须同时钉住
 * **数量**和**内容各自不同**，只钉数量的版本对 ③ 恒绿。
 *
 * ## 内容差异为什么读落库消息，不读画布内部
 *
 * 围栏渲染成的是 fabric.js canvas（位图），DOM 里没有可断言的文本节点。落库的那条
 * agent 消息正文是**同一份事实的权威形态**（渲染就是从它解析出来的），读它既能证明
 * 「上游确实产出了两个内容不同的围栏」，又不依赖画布内部实现——同
 * `chat-diagram-save-reopen-roundtrip.spec.ts` 读围栏源的既有做法。
 */
test.setTimeout(180_000);

const PROOF = `帮我并排出两张图，代号 ${CHAT_READ_E2E.canvasGuidanceSentinel} ${CHAT_READ_E2E.canvasDualSentinel}`;

test("@path:C4 一轮请求产出两个画布：两个都渲染、内容各不相同、互不覆盖", async ({ page }) => {
  await login(page);
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.restructureProjectId}&thread=${CHAT_READ_E2E.canvasDualThreadId}`);
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.canvasDualThreadId}`))
    .toContainText("Canvas dual fence in one turn check thread");

  await sendOnProjectThread(page, CHAT_READ_E2E.canvasDualThreadId, PROOF);
  const reply = await awaitProjectThreadReply(page);

  // ── ① 数量：两个围栏都真的挂上了，且都渲染就绪 ──
  const fabrics = reply.locator('[data-testid="chat-canvas-fabric"]');
  await expect(
    fabrics,
    "一轮里产出的两个 canvas 围栏都必须挂出来——只挂第一个是解析器丢掉后续围栏的典型形态",
  ).toHaveCount(2, { timeout: 90_000 });
  await expect(fabrics.nth(0)).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  await expect(fabrics.nth(1)).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  // 诚实失败态必须为空：出现「无法渲染」说明上面的 ready 断言本身就该已经红了。
  await expect(page.getByTestId("chat-canvas-error")).toHaveCount(0);

  // ── ② 内容：两份围栏源各自不同，且都带着这一轮请求的原文（不是写死的固定串）──
  const messages = await storedMessages(page, CHAT_READ_E2E.canvasDualThreadId);
  const answer = messages.find((message) => message.authorKind === "agent" && message.text.includes("```canvas"));
  expect(answer, "这一轮必须落库一条带 canvas 围栏的 agent 回复").toBeDefined();
  const fenceCount = (answer!.text.match(/```canvas/g) ?? []).length;
  expect(fenceCount, "落库正文里必须真的有两个围栏——只有一个说明上游剧本没命中双围栏分支").toBe(2);
  expect(
    answer!.text.includes(`${CHAT_READ_E2E.canvasHeaderFieldName}: ${PROOF} 之一`),
    "第一个围栏的表头字段必须带这一轮请求的原文",
  ).toBe(true);
  expect(
    answer!.text.includes(`${CHAT_READ_E2E.canvasHeaderFieldName}: ${PROOF} 之二`),
    "第二个围栏必须有**自己**的内容——两个围栏内容相同 = 后一个覆盖了前一个，正是本条要挡的",
  ).toBe(true);

  // ── ③ 落库复核：刷新后两个都还在，不是渲染在内存里的一帧 ──
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-testid="chat-canvas-fabric"]')).toHaveCount(2, { timeout: 90_000 });
});
