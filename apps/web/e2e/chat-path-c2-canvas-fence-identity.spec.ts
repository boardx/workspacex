import { expect, test } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { openFreshEchoAgentThread, sendInV2AndAwaitStoredReply } from "./support/chat-path-coverage";

/**
 * 路径矩阵 **C2 · 画布编辑往返**——补的是这条判据里此前无人断言的那半：
 * 重开时看到的保存版，**必须是这个围栏自己的**。
 *
 * ## 被测缺陷（issue #3252，**当前未修**）
 *
 * 画布的身份判定粒度是**模板名**，不是围栏。保存链路上唯一的关联键是
 * `(threadId, messageId)`（表 `chat_artifact_landings` 没有围栏序号也没有模板列），
 * 围栏之间的区分完全靠客户端 `chat-canvas-fabric.tsx` 的这段：
 *
 * ```ts
 * const acceptsSavedSource = (markdown: string) => {
 *   const checked = checkCanvasFence(markdown, lang);
 *   return checked.ok && checked.key === sourceTemplateKey;   // ← 只比模板 key
 * };
 * ```
 *
 * 于是**同一条助手消息里两个同模板的画布会互相认领对方的保存版**：编辑并保存第一个，
 * 第二个在挂载即读回时把第一个的字节当成"自己的保存版"读进来。
 *
 * ⚠ 这个形态在真实使用里**很可能出现，不是构造出来的极端**：#3243 那次人类实测一轮
 * 就要了 10 个画布模板，其中出现重复模板几乎是必然。
 *
 * ## 为什么用「两个**同模板**围栏」，而不是两个不同模板
 *
 * 两个不同模板的围栏在今天的实现下**也会通过**——`checked.key` 不同就拒了。用不同模板
 * 写出来的用例对这个缺陷恒绿，等于没测。缺陷的形状就是"同模板不可分"，判据必须长成
 * 同一个形状。C4 那条 dual 剧本产出的两个围栏正好共用同一个模板 key，直接复用。
 *
 * ## 处置：`test.fixme`，阻塞于 #3252
 *
 * 断言是对的、产品还没做到 —— 沿用本仓既有裁决（issue #2997 方案 B，A3/C8 两次先例）：
 * **不删断言、不改宽、不 `test.skip`**。#3252 补上围栏级身份之后把 `fixme` 改回
 * `test` 即可，正文一个字都不用动。`test.skip` 刻意不用：skip 掉的差距等于不存在，
 * 那正是这套门控要挡的（`lint-chat-path-coverage.mjs` 也只认 `test` 与 `test.fixme`）。
 */
test.setTimeout(240_000);

const PROOF = `帮我并排出两张图，代号 ${CHAT_READ_E2E.canvasGuidanceSentinel} ${CHAT_READ_E2E.canvasDualSentinel}`;
/** C4 剧本给两个围栏的表头字段后缀——「之一」属于第一个围栏，「之二」属于第二个。 */
const OWN_FIRST = "之一";
const OWN_SECOND = "之二";

test.fixme("@path:C2 同一消息内两个同模板画布：各自的保存版不互相认领（阻塞于 #3252）", async ({ page }) => {
  const threadId = await openFreshEchoAgentThread(page);
  await sendInV2AndAwaitStoredReply(page, threadId, PROOF, ["```canvas", OWN_SECOND]);

  const fabrics = page.locator('[data-testid="chat-canvas-fabric"]');
  await expect(fabrics, "这一轮必须挂出两个画布，否则下面的身份判据无从谈起").toHaveCount(2, { timeout: 120_000 });
  await expect(fabrics.nth(0)).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  await expect(fabrics.nth(1)).toHaveAttribute("data-ready", "true", { timeout: 60_000 });

  // ── ① 只编辑并保存**第一个**围栏。第二个从头到尾没被碰过 ───────────────────
  await fabrics.nth(0).getByTestId("chat-canvas-maximize").click();
  await expect(page.getByTestId("chat-canvas-modal")).toBeVisible();
  await expect(
    page.getByTestId("chat-canvas-loaded-saved"),
    "第一次打开：这条消息名下还没有任何保存版，不该出现读回提示条",
  ).toHaveCount(0);
  await expect(page.getByTestId("chat-canvas-fabric-surface").last()).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("chat-canvas-tool-sticky").click();
  const surface = page.getByTestId("chat-canvas-fabric-surface").last();
  const box = (await surface.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.8);
  await expect(page.getByTestId("chat-canvas-dirty")).toBeVisible();

  const landed = page.waitForResponse((r) =>
    r.request().method() === "POST" && r.url().endsWith(`/chat/threads/${threadId}/artifacts`));
  await page.getByTestId("chat-canvas-save").click();
  expect((await landed).status()).toBe(200);
  await expect(page.getByTestId("chat-canvas-saved")).toBeVisible();
  const firstSaved = await page.getByTestId("chat-canvas-saved-source").textContent();
  expect(firstSaved, "第一个围栏保存的必须是它自己的内容").toContain(OWN_FIRST);
  await page.getByTestId("chat-canvas-close").click();

  // ── ② 整页刷新，穿透前端内存态：两个围栏各自重新走一次「挂载即读回」──────────
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(fabrics).toHaveCount(2, { timeout: 120_000 });
  await expect(fabrics.nth(1)).toHaveAttribute("data-ready", "true", { timeout: 60_000 });

  // ── ③ 判据：**第二个**围栏没有属于自己的保存版，就不该显示任何保存版 ──────────
  await fabrics.nth(1).getByTestId("chat-canvas-maximize").click();
  await expect(page.getByTestId("chat-canvas-modal")).toBeVisible();
  await expect(
    page.getByTestId("chat-canvas-loaded-saved"),
    "第二个围栏从未被保存过——出现读回提示条 = 它认领了第一个围栏的保存版（#3252）",
  ).toHaveCount(0);

  /*
   * 提示条只说明"读回发生了没有"，不说明"读回的内容是谁的"。再从这个 modal 保存一次，
   * 读回显的源：内容判据才是真判据（本仓纪律：不拿"元素存在/不存在"当业务断言）。
   *   · 含「之二」不含「之一」⇒ modal 是用**第二个围栏自己的**原文初始化的（应该的样子）；
   *   · 含「之一」⇒ 它把第一个围栏的保存字节当成了自己的（#3252 的直接现形）。
   */
  await expect(page.getByTestId("chat-canvas-fabric-surface").last()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("chat-canvas-save").click();
  await expect(page.getByTestId("chat-canvas-saved")).toBeVisible();
  const secondSaved = await page.getByTestId("chat-canvas-saved-source").textContent();
  expect(secondSaved, "第二个围栏保存出去的必须是它自己的内容").toContain(OWN_SECOND);
  expect(
    secondSaved,
    "第二个围栏的内容里绝不该出现第一个围栏的表头字段值——出现即两个同模板画布"
    + "互相认领了保存版（#3252）",
  ).not.toContain(OWN_FIRST);
});
