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
 * ⚠ 转回来之后**连红三轮，三轮都红在取数机制上，没有一轮红在判据上**。两层坑叠在
 * 一起，逐层剥（完整推导见下面 ① 处注释）：
 *   1. **点错了画布**：点的是气泡里的只读预览 `chat-canvas-fabric-surface`，而全屏
 *      编辑器 `fixed inset-0 z-50` 正盖在它上面，那一点全落到遮罩上。改成编辑器
 *      自己那张 `canvas-fabric-surface` 后这一层过了（`:68` 的 `toBeVisible` 不再红）。
 *   2. **点对了画布、点错了地方**：80%/80% 落在**分区框内**，而分区框在全屏编辑器里
 *      是可命中的 target（`locked` 只是初值，`canvas-stage.tsx` 的只读态 effect 对
 *      全部对象 `obj.evented = !readOnly`），`mouse:down` 的 `if (opt.target) return`
 *      直接早退——便签落不下，`chat-canvas-dirty` 永远不出现。改坐标到标题带右侧的
 *      空白区，这一层才过。
 * 第 2 层曾被当作「已排除的猜想」撤回过（依据是 `canvas-io.ts:133` 对 `locked` 节点
 * `evented: false`），**那次撤回本身是错的**——它漏了 `canvas-stage.tsx` 后面那次
 * 统一覆盖。现在两层都有 docker-free 的反证钉住：
 * `tests/ui/canvas-stage-sticky-drop-hit-target.test.tsx` 用同一支模板、同一条
 * `mouse:down` 链、同样这两个坐标，判「点分区框内落不下、点空白处落得下」。
 *
 * **停放期间写下的断言从来没有被执行过，所以它的取数机制也从来没有被验证过**——
 * 这正是 `test.fixme` 这种停放方式的代价：判据可以是对的、跑法可以是错的，而只要
 * 它没跑过就没人知道，「正文一个字都不用动」这句当初的预期也就无从成立。改的全在
 * 取数机制（选择器 + 落点坐标），**一条 `expect` 都没有放宽、没有删除、没有 skip**。
 */
test.setTimeout(240_000);

const PROOF = `帮我并排出两张图，代号 ${CHAT_READ_E2E.canvasGuidanceSentinel} ${CHAT_READ_E2E.canvasDualSentinel}`;
/**
 * 「＋便签」落点距画布顶部的像素数——标题带与网格首行之间那条空白（见下面 ③ 处注释
 * 的推导）。不是随手取的余量：网格首行自 y≈96 起画，标题带高到 y≈49。
 */
const STICKY_DROP_Y = 60;
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
  // 工具态真的切过去了——下一步点不出便签时，这条能立刻把「工具没生效」排除掉，
  // 不用再靠 trace 去猜（前两轮 CI 正是卡在「点了没反应，但不知道断在哪一层」）。
  await expect(page.getByTestId("canvas-active-tool")).toHaveText(/＋便签/);
  /*
   * ⚠ 三条坑叠在同一次点击上，缺一不可：
   *
   * ① 必须是 `canvas-fabric-surface`（全屏编辑器 `CanvasStage` 里那张**可编辑**画布），
   *   **不是** `chat-canvas-fabric-surface`（气泡里的只读预览）——两者共享 fabric.js
   *   但是两份 DOM 节点，`chat-canvas-guidance-render.spec.ts` 已经把这个区分写在注释
   *   里了。本用例首次真跑（此前一直是 `test.fixme`）时点的是只读预览的坐标，而
   *   `ChatCanvasModal` 是 `fixed inset-0 z-50` 铺满视口的：`page.mouse.click` 只按绝对
   *   坐标找**最上层**元素派发事件，于是那一点全部落在 modal 遮罩上。
   *
   * ② 用 `page.mouse.click` 而不是 `locator.click({position})`：testid 挂在 fabric 的
   *   lower-canvas 上，真正监听指针事件的是叠在它上面的 upper-canvas，可达性检查会
   *   如实挡下这次点击。推导见 `canvas-template-simulate-smoke.spec.ts` 同名注释。
   *
   * ③ **落点必须是画布上真正的空白**，不能照抄
   *   `chat-diagram-save-reopen-roundtrip.spec.ts` 的 80%/80%——那条是 mermaid 单图，
   *   右下角确实空；本用例渲染的是**画布模板**，那里 80%/80% 落在「要点」分区框**内**。
   *   分区框在 `template-engine.ts` 里虽是 `locked`，但那只是初值：`canvas-stage.tsx`
   *   的只读态 effect 对全部对象执行 `obj.evented = !readOnly`，全屏编辑器
   *   （`readOnly={false}`）里它重新变成可命中 target，于是 `mouse:down` 第一句
   *   `if (opt.target) { … return; }` 早退，「＋便签」只在点到**空白**时才落便签
   *   （CI 实测：便签没落下 ⇒ `chat-canvas-dirty` 等待超时，连红两轮）。
   *
   *   取「标题带右侧」这块空白，两个方向都留足余量（几何由
   *   `buildExplicitTemplateSpec` 算出，实测值见 `canvas-stage-sticky-drop-hit-target.test.tsx`）：
   *     · 横向——标题文本框右边界约 x≈405，画布最窄也有 600（`CanvasStage` 挂载时
   *       `Math.max(600, …)`），80% 处 ≥480，稳定落在标题右侧；
   *     · 纵向——网格首行（表头字段框）自 y≈96 起画，取 y=60 时上距标题带、下距网格
   *       各有约 35px 余量。
   *   落点在所有分区框之外 ⇒ 走 `mouse:down` 的夹取分支，便签归入最近的分区（本模板
   *   只有「要点」一个），所见即所存，不是游离便签。
   */
  const surface = page.getByTestId("canvas-fabric-surface");
  const box = (await surface.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.8, box.y + STICKY_DROP_Y);
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
