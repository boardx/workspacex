import { expect, test } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { openFreshEchoAgentThread, sendInV2AndAwaitStoredReply } from "./support/chat-path-coverage";

/**
 * 路径矩阵 **C2 · 画布编辑往返**——补的是这条判据里此前无人断言的那半：
 * 重开时看到的保存版，**必须是这个围栏自己的**。
 *
 * ## 被测缺陷（issue #3252，**已修**）
 *
 * 画布的身份判定粒度曾经是**模板名**，不是围栏。保存链路上唯一的关联键是
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
 * 修法是把身份粒度做到**围栏级**：围栏原文的内容指纹随落地标题走，读回时按指纹
 * 归属（`lib/canvas/canvas-fence-identity.ts`，**不是**按出现顺序编号——重排/增删/
 * 流式重放都会让顺序变化）。同一判据在组件层的反证见
 * `tests/ui/chat-canvas-fence-identity-readback.test.tsx`。
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
 * ## 处置：`test.fixme` → `test`（#3252 修复随附）
 *
 * 这条断言当初按本仓既有裁决（issue #2997 方案 B，A3/C8 两次先例）停放成 `test.fixme`：
 * **不删断言、不改宽、不 `test.skip`**，等产品补上围栏级身份再转回真断言。现在围栏级
 * 身份已经补上，于是转回 `test`。
 *
 * ⚠ 转回来之后**首次真跑就红了，红在取数机制上，不在判据上**：它点的是气泡里的
 * 只读预览 `chat-canvas-fabric-surface`，而全屏编辑器 `fixed inset-0 z-50` 正盖在
 * 它上面，那一点全落到遮罩上，便签根本没落下去（详见下面 ① 处注释）。
 * **停放期间写下的断言从来没有被执行过，所以它的取数机制也从来没有被验证过**——
 * 这正是 `test.fixme` 这种停放方式的代价：判据可以是对的、跑法可以是错的，而只要
 * 它没跑过就没人知道，「正文一个字都不用动」这句当初的预期也就无从成立。修的是
 * 选择器（换成编辑器自己那张 `canvas-fabric-surface`），**一条 `expect` 都没有
 * 放宽、没有删除、没有 skip**。
 */
test.setTimeout(240_000);

const PROOF = `帮我并排出两张图，代号 ${CHAT_READ_E2E.canvasGuidanceSentinel} ${CHAT_READ_E2E.canvasDualSentinel}`;
/** C4 剧本给两个围栏的表头字段后缀——「之一」属于第一个围栏，「之二」属于第二个。 */
const OWN_FIRST = "之一";
const OWN_SECOND = "之二";

test("@path:C2 同一消息内两个同模板画布：各自的保存版不互相认领（#3252 回归门）", async ({ page }) => {
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
  await expect(page.getByTestId("canvas-fabric-surface")).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("chat-canvas-tool-sticky").click();
  /*
   * ⚠ 这里必须是 `canvas-fabric-surface`（全屏编辑器 `CanvasStage` 里那张**可编辑**
   *   画布），**不是** `chat-canvas-fabric-surface`（气泡里的只读预览）——两者共享
   *   fabric.js 但是两份 DOM 节点，`chat-canvas-guidance-render.spec.ts` 已经把这个
   *   区分写在注释里了。本用例首次真跑（此前一直是 `test.fixme`）时点的是只读预览的
   *   坐标，而 `ChatCanvasModal` 是 `fixed inset-0 z-50` 铺满视口的：`page.mouse.click`
   *   只按绝对坐标找**最上层**元素派发事件，于是这一点全部落在 modal 遮罩上，便签
   *   根本没落下去，`chat-canvas-dirty` 永远不出现（CI 实测：:74 等待超时）。
   * ⚠ 用 `page.mouse.click` 而不是 `locator.click({position})`：testid 挂在 fabric 的
   *   lower-canvas 上，真正监听指针事件的是叠在它上面的 upper-canvas，可达性检查会
   *   如实挡下这次点击。两条坑的完整推导见 `canvas-template-simulate-smoke.spec.ts`
   *   同名注释，此处不复述；坐标取 80%/80% 与既有先例
   *   `chat-diagram-save-reopen-roundtrip.spec.ts` 逐字一致。
   */
  const surface = page.getByTestId("canvas-fabric-surface");
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
  await expect(page.getByTestId("canvas-fabric-surface")).toBeVisible({ timeout: 30_000 });
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
