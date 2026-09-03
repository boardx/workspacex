/**
 * 🟡 2026-08-27 —— 「编辑界面需要有测试的功能……需要有一个 chat 界面模拟，输出过程，
 * 可以输入一段提示词，需要出来实际的结果」（人类原话）的**真实浏览器**门控。
 *
 * 链路一节不许省：Chromium → `TemplateSimulateDialog` → Next 同源代理 →
 * NestJS `POST /canvas/templates/:key/simulate` → `simulateTemplateRun` 用例 →
 * `ModelCallPort.complete` → 确定性上游 `loopback-model-provider.ts`
 * （见该脚本文件头，本仓 E2E 全程不接真实外部模型——同 `chat-vision-honest-degrade.spec.ts`
 * 的既有纪律）→ 响应体原样回到浏览器 → 解析成围栏 → 真实 `CanvasStage`（fabric.js，
 * `template-simulate-dialog.tsx` R2）渲染。
 *
 * ## 「回显即证明」——不是伪造证据，是复用这条仓库既有的确定性取证手段
 *
 * `loopback-model-provider.ts` 默认行为是把 user message 原样回显（带一个前缀，见该
 * 脚本 `REPLY_PREFIX` 常量）。本用例利用这一点：提示词本身就写成一份合法的
 * ```canvas 围栏（`模板: <key>` + 表头字段 + `## 分区名` 正文），模型原样回显它
 * （多出来的前缀文字不影响围栏被 `extractMermaidBlocks` 识别——它扫的是围栏定界符，
 * 不要求消息以定界符开头）。
 *
 * ## 内容断言走的是哪条通道
 *
 * fabric 画布画的是像素，肉眼/自动化都读不到画布里的文字——`toContainText` 断言的
 * 是弹窗里那段常驻的「模型原始回复」诊断区（`tpladmin-editor-simulate-source`，
 * `template-simulate-dialog.tsx` R2 头注「fabric 画的是像素……靠这段兜底」），它显示
 * 的就是 `/simulate` 响应体原文，不是本地编造。真正证明"fabric 引擎确实跑起来了"的
 * 是 `canvas-fabric-surface`（`CanvasStage` 唯一的 `<canvas>` 元素）变为可见——两条
 * 断言合起来才是完整的证明链：**内容**来自网络响应 + **渲染**真的用了 fabric 引擎。
 *
 * ⚠ 来源模板现场建 + 加字段，不往种子里塞——理由同 `mintSourceKey`（#988）：往种子里加
 *   一条模板行会打红 `canvas-template-create-smoke.spec.ts` 的管理员空态反空转断言。
 */
import { expect, test, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

const API = "/__fullstack_api";

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.adminEmail);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

test("admin types a prompt into chat 模拟, gets a real model round trip back, and it renders on the canvas grid", async ({ page }) => {
  const { canvasSimulateName: NAME } = FULLSTACK_E2E;

  await loginAsAdmin(page);
  await page.goto("/canvas/template-admin?view=list");
  await expect(page.getByTestId("tpladmin-root")).toBeVisible();

  // ── 前置：现场建来源模板 + 加两个字段（表头短文本 + 正文便利贴列表）──────────
  const createResponsePromise = page.waitForResponse(
    (r) => new URL(r.url()).pathname === `${API}/canvas/templates` && r.request().method() === "POST",
  );
  await page.getByTestId("tpladmin-create").click();
  await expect(page.getByTestId("tpladmin-create-dialog")).toBeVisible();
  await page.getByTestId("tpladmin-create-name").fill(NAME);
  await page.getByTestId("tpladmin-create-submit").click();
  const created = await (await createResponsePromise).json() as { key: string };
  const KEY = created.key;

  await expect(page.getByTestId("tpladmin-editor-panel")).toBeVisible();

  // 表头字段：短文本「姓名」，key=name。
  await page.getByTestId("tpladmin-editor-new-key").fill("name");
  await page.getByTestId("tpladmin-editor-new-name").fill("姓名");
  await page.getByTestId("tpladmin-editor-new-type-短文本").click();
  await page.getByTestId("tpladmin-editor-new-add").click();

  // 正文分区：便利贴列表「要点」，key=points（默认类型即为便利贴列表，不需要再点类型）。
  await page.getByTestId("tpladmin-editor-new-key").fill("points");
  await page.getByTestId("tpladmin-editor-new-name").fill("要点");
  await page.getByTestId("tpladmin-editor-new-add").click();

  // 一键排版——避免在 Playwright 里模拟 HTML5 拖拽（本仓既有惯例：能用一次点击达成
  // 「两个字段都已放置」这个前置条件，就不去模拟脆弱的拖拽手势）。
  await page.getByTestId("tpladmin-editor-autolayout").click();
  await expect(page.getByTestId("tpladmin-editor-field-name")).toBeVisible();
  await expect(page.getByTestId("tpladmin-editor-field-points")).toBeVisible();

  await page.getByTestId("tpladmin-editor-save").click();
  await expect(page.getByTestId("tpladmin-editor-save")).toHaveText("已保存");

  // ── 打开 chat 模拟，键入一份「提示词本身就是合法围栏」的文本 ─────────────────
  await page.getByTestId("tpladmin-editor-simulate-toggle").click();
  await expect(page.getByTestId("tpladmin-editor-simulate-dialog")).toBeVisible();

  const ECHOED_NAME_VALUE = `E2E小李_${KEY.slice(-6)}`;
  const ECHOED_POINT_VALUE = `E2E要点_${KEY.slice(-6)}`;
  // ⚠ 前导空行是必须的，不是装饰：`loopback-model-provider.ts` 的回显把前缀词
  //   `[loopback] ` 与我们打的提示词**用同一个空格拼在同一行**（不是换行），
  //   而 `extractMermaidBlocks`（生产 chat 切段用的同一个抽取器）只认「``` 在
  //   一行的行首」——`[loopback] \`\`\`canvas` 这种同一行前缀会让围栏识别不到，
  //   `extractMermaidBlocks` 直接返回空数组。真实调试实测：本用例第一版没有这个
  //   前导空行，`fenceTextToRunData` 稳定复现返回 `null`，界面回退成
  //   `tpladmin-editor-simulate-raw`——这不是本仓的一个新 bug（真实模型的围栏本来就
  //   总是自己另起一行），而是「用回显文本本身当围栏来源」这个测试手法自己引入的
  //   人为间隙，所以在测试这一侧补一个换行，不去改生产的抽取器。
  const prompt = [
    "",
    "```canvas",
    `模板: ${KEY}`,
    `姓名: ${ECHOED_NAME_VALUE}`,
    "## 要点",
    `- ${ECHOED_POINT_VALUE}`,
    "```",
  ].join("\n");

  await page.getByTestId("tpladmin-editor-simulate-input").fill(prompt);

  const simulateResponsePromise = page.waitForResponse(
    (r) => new URL(r.url()).pathname === `${API}/canvas/templates/${KEY}/simulate` && r.request().method() === "POST",
  );
  await page.getByTestId("tpladmin-editor-simulate-run").click();
  const simulateResponse = await simulateResponsePromise;
  // 真实 200，不是本地假装成功——`simulateTemplateRun.out` 契约的正常出口。
  expect(simulateResponse.status()).toBe(200);
  const simulateBody = await simulateResponse.json() as { text: string; modelId: string };
  // 响应体里真的带着我们打的字——不是一段固定桩数据（`loopback-model-provider.ts`
  // 的「回显」行为本身就是这条断言成立的原因，见文件头）。
  expect(simulateBody.text).toContain(ECHOED_NAME_VALUE);
  expect(simulateBody.text).toContain(ECHOED_POINT_VALUE);

  // ── 渲染结果：不是「原文回退」态，真的起了一个 fabric.js 画布 ─────────────────
  await expect(page.getByTestId("tpladmin-editor-simulate-result")).toBeVisible();
  await expect(page.getByTestId("tpladmin-editor-simulate-raw")).toHaveCount(0);
  // fabric 引擎真的跑了一次解析并挂了一张 `<canvas>`——不是仍停在占位态。
  await expect(page.getByTestId("canvas-fabric-surface")).toBeVisible({ timeout: 30_000 });
  // 工具条也在——「可以修改」这条要求的可见证据（人类原话：「必须用 fabricjs 来渲染，
  // 这样的话可以修改」）。
  await expect(page.getByTestId("tpladmin-editor-simulate-tool-select")).toBeVisible();
  await expect(page.getByTestId("tpladmin-editor-simulate-tool-sticky")).toBeVisible();
  const result = page.getByTestId("tpladmin-editor-simulate-result");
  await expect(result).toContainText(ECHOED_NAME_VALUE);
  await expect(result).toContainText(ECHOED_POINT_VALUE);

  await page.getByTestId("tpladmin-editor-simulate-close").click();
  await expect(page.getByTestId("tpladmin-editor-simulate-dialog")).toHaveCount(0);
});

/**
 * 🔴 反证（常驻）：把 `/simulate` 的响应**拦截**成一段不含真实提示词内容的桩数据，
 * 界面必须原样渲染桩数据里的字（而不是我们打的提示词），证明渲染结果确实来自
 * 网络响应本身，不是本地对提示词做了一份自己的解析/回显。
 *
 * ⚠ 这与上面那条主用例互补：主用例证明「真实响应会被渲染」，这条证明「渲染的是
 *   响应体，不是别的什么东西」——少了这条，即便 `/simulate` 被换成一个完全不读
 *   请求体、只会拼一句固定话术的假实现，上面那条用真实回显做断言的用例也可能因为
 *   凑巧而通过（如果桩实现恰好也做了字符串拼接）。
 */
test("counterproof: the rendered result reflects the network response body, not the typed prompt verbatim", async ({ page }) => {
  const { canvasSimulateCounterproofName: NAME } = FULLSTACK_E2E;

  await loginAsAdmin(page);
  await page.goto("/canvas/template-admin?view=list");
  await expect(page.getByTestId("tpladmin-root")).toBeVisible();

  const createResponsePromise = page.waitForResponse(
    (r) => new URL(r.url()).pathname === `${API}/canvas/templates` && r.request().method() === "POST",
  );
  await page.getByTestId("tpladmin-create").click();
  await expect(page.getByTestId("tpladmin-create-dialog")).toBeVisible();
  await page.getByTestId("tpladmin-create-name").fill(NAME);
  await page.getByTestId("tpladmin-create-submit").click();
  const created = await (await createResponsePromise).json() as { key: string };
  const KEY = created.key;

  await expect(page.getByTestId("tpladmin-editor-panel")).toBeVisible();
  await page.getByTestId("tpladmin-editor-new-key").fill("points");
  await page.getByTestId("tpladmin-editor-new-name").fill("要点");
  await page.getByTestId("tpladmin-editor-new-add").click();
  await page.getByTestId("tpladmin-editor-autolayout").click();
  await expect(page.getByTestId("tpladmin-editor-field-points")).toBeVisible();
  await page.getByTestId("tpladmin-editor-save").click();
  await expect(page.getByTestId("tpladmin-editor-save")).toHaveText("已保存");

  const STUBBED_VALUE = `STUBBED_NOT_FROM_PROMPT_${KEY.slice(-6)}`;
  let intercepted = 0;
  await page.route(`**${API}/canvas/templates/${KEY}/simulate`, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    intercepted += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        text: ["```canvas", `模板: ${KEY}`, "## 要点", `- ${STUBBED_VALUE}`, "```"].join("\n"),
        modelProvider: "stub",
        modelId: "stub",
      }),
    });
  });

  await page.getByTestId("tpladmin-editor-simulate-toggle").click();
  await expect(page.getByTestId("tpladmin-editor-simulate-dialog")).toBeVisible();
  await page.getByTestId("tpladmin-editor-simulate-input").fill("这段提示词里完全没有出现桩数据里的那句话");
  await page.getByTestId("tpladmin-editor-simulate-run").click();

  await expect(page.getByTestId("tpladmin-editor-simulate-result")).toBeVisible();
  await expect(page.getByTestId("canvas-fabric-surface")).toBeVisible({ timeout: 30_000 });
  expect(intercepted).toBe(1);
  // 界面上出现的是桩数据里的字，不是我们打的提示词原文——渲染的是网络响应。
  await expect(page.getByTestId("tpladmin-editor-simulate-result")).toContainText(STUBBED_VALUE);
});

/**
 * 🟢 R2 补测（2026-08-28，人类原话「必须用 fabricjs 来渲染，这样的话可以修改」）——
 * 此前只验证到「canvas 挂载了、工具条按钮在」，从没验证过在画布上真的点一下有没有
 * 效果。这条用「＋便签」工具在画布上点一下，断言 `tpladmin-editor-simulate-edited`
 * 出现——这个信号只有 `CanvasStage` 的 `onMarkdownChange` 真的被 fabric 场景变化
 * 触发过一次才会出现（`template-simulate-dialog.tsx` 同名 state 头注），不是猜的。
 *
 * 点击手法照抄 `chat-diagram-save-reopen-roundtrip.spec.ts` 既有先例（拿
 * `boundingBox()` 后点 80%/80% 处，不点正中心）。
 */
test("R2：结果画布真的可以编辑——点「＋便签」工具落一张便签，画布状态真的变了", async ({ page }) => {
  const { canvasSimulateEditName: NAME } = FULLSTACK_E2E;

  await loginAsAdmin(page);
  await page.goto("/canvas/template-admin?view=list");
  await expect(page.getByTestId("tpladmin-root")).toBeVisible();

  const createResponsePromise = page.waitForResponse(
    (r) => new URL(r.url()).pathname === `${API}/canvas/templates` && r.request().method() === "POST",
  );
  await page.getByTestId("tpladmin-create").click();
  await expect(page.getByTestId("tpladmin-create-dialog")).toBeVisible();
  await page.getByTestId("tpladmin-create-name").fill(NAME);
  await page.getByTestId("tpladmin-create-submit").click();
  const created = await (await createResponsePromise).json() as { key: string };
  const KEY = created.key;

  await expect(page.getByTestId("tpladmin-editor-panel")).toBeVisible();
  await page.getByTestId("tpladmin-editor-new-key").fill("points");
  await page.getByTestId("tpladmin-editor-new-name").fill("要点");
  await page.getByTestId("tpladmin-editor-new-add").click();
  await page.getByTestId("tpladmin-editor-autolayout").click();
  await expect(page.getByTestId("tpladmin-editor-field-points")).toBeVisible();
  await page.getByTestId("tpladmin-editor-save").click();
  await expect(page.getByTestId("tpladmin-editor-save")).toHaveText("已保存");

  await page.getByTestId("tpladmin-editor-simulate-toggle").click();
  await expect(page.getByTestId("tpladmin-editor-simulate-dialog")).toBeVisible();

  // 同主用例的手法：提示词本身就是一份合法围栏，loopback 原样回显。
  const prompt = ["", "```canvas", `模板: ${KEY}`, "## 要点", "- 编辑前的要点"].join("\n") + "\n```";
  await page.getByTestId("tpladmin-editor-simulate-input").fill(prompt);
  const simulateResponsePromise = page.waitForResponse(
    (r) => new URL(r.url()).pathname === `${API}/canvas/templates/${KEY}/simulate` && r.request().method() === "POST",
  );
  await page.getByTestId("tpladmin-editor-simulate-run").click();
  expect((await simulateResponsePromise).status()).toBe(200);
  await expect(page.getByTestId("canvas-fabric-surface")).toBeVisible({ timeout: 30_000 });

  // 编辑前：不该出现「已编辑」标记——还没碰过画布。
  await expect(page.getByTestId("tpladmin-editor-simulate-edited")).toHaveCount(0);

  await page.getByTestId("tpladmin-editor-simulate-tool-sticky").click();
  // ⚠ 真栈 E2E 两轮实测踩出的两层坑，缺一不可：
  //
  // ① `canvas-fabric-surface` 这个 testid 挂在 fabric 的 **lower-canvas**（渲染层）
  //   上，但 fabric 真正监听指针事件的是它上面**另起一层**的 `upper-canvas`
  //   （`class="upper-canvas"`，同一个 `<canvas-container>` 里的兄弟节点，绝对定位
  //   叠在 lower-canvas 正上方）——`locator.click({position})` 走的是"这个元素真的
  //   可点击"的可达性检查，第一轮实测超时报的正是
  //   `<canvas class="upper-canvas"> intercepts pointer events`，检查如实挡下了这次
  //   点击，不是查漏了。`page.mouse.click(x, y)` 不做元素归属检查，只在给定的绝对
  //   像素坐标上找当前最上层的元素派发事件——那正好就是 upper-canvas，是唯一能真的
  //   触发 fabric `mouse:down` 处理器的点法。
  //
  // ② 但绝对坐标本身也不能瞎给：`chat-diagram-save-reopen-roundtrip.spec.ts` 那条
  //   既有先例点 80%/80% 处是安全的，因为那个编辑器是 `fixed inset-0` 铺满整个视口
  //   （见 `chat-canvas-modal.tsx`）——视口内任何一点都必然落在它里面。本弹窗是
  //   Radix `Dialog`，一个有边界的卡片，不是铺满视口；`boundingBox()` 量出来的矩形
  //   边缘可能已经超出弹窗卡片实际可见范围——点在那（尤其是右下角附近）会落在弹窗
  //   外的遮罩层上，Radix 判定为"点了外面"直接把弹窗关掉（第零轮实测：断言超时时
  //   截图看到的是弹窗已经整个消失）。改成左上角一个小偏移量，稳稳落在弹窗卡片
  //   可见范围内。
  const surface = page.getByTestId("canvas-fabric-surface");
  const box = (await surface.boundingBox())!;
  await page.mouse.click(box.x + 40, box.y + 40);

  // 真的落了一张便签——`onMarkdownChange` 真的被 fabric 场景变化触发过。
  await expect(page.getByTestId("tpladmin-editor-simulate-edited")).toBeVisible();

  await page.getByTestId("tpladmin-editor-simulate-close").click();
  await expect(page.getByTestId("tpladmin-editor-simulate-dialog")).toHaveCount(0);
});

/**
 * 🟢 R2 补测——`simulateTemplateRun` 用例契约里的 `TEMPLATE_SIMULATION_UNAVAILABLE`
 * 已经在 `apps/api/tests/canvas/simulate-template-run-http.test.ts` 真库测过（503 +
 * 该 reasonCode、不落库），但从没在真实浏览器里验证过：这条失败到了前端会不会被
 * 诚实地展示出来，还是被静默吞掉、界面停在「运行中」转圈。
 */
test("R2：模型调不通时，浏览器里看到的是诚实的错误提示，不是卡死或假成功", async ({ page }) => {
  const { canvasSimulateErrorName: NAME } = FULLSTACK_E2E;

  await loginAsAdmin(page);
  await page.goto("/canvas/template-admin?view=list");
  await expect(page.getByTestId("tpladmin-root")).toBeVisible();

  const createResponsePromise = page.waitForResponse(
    (r) => new URL(r.url()).pathname === `${API}/canvas/templates` && r.request().method() === "POST",
  );
  await page.getByTestId("tpladmin-create").click();
  await expect(page.getByTestId("tpladmin-create-dialog")).toBeVisible();
  await page.getByTestId("tpladmin-create-name").fill(NAME);
  await page.getByTestId("tpladmin-create-submit").click();
  const created = await (await createResponsePromise).json() as { key: string };
  const KEY = created.key;

  await expect(page.getByTestId("tpladmin-editor-panel")).toBeVisible();
  await page.getByTestId("tpladmin-editor-new-key").fill("points");
  await page.getByTestId("tpladmin-editor-new-name").fill("要点");
  await page.getByTestId("tpladmin-editor-new-add").click();
  await page.getByTestId("tpladmin-editor-autolayout").click();
  await expect(page.getByTestId("tpladmin-editor-field-points")).toBeVisible();
  await page.getByTestId("tpladmin-editor-save").click();
  await expect(page.getByTestId("tpladmin-editor-save")).toHaveText("已保存");

  // 拦截成契约真实会产出的 503 信封——不是编一个前端从没见过的形状。
  await page.route(`**${API}/canvas/templates/${KEY}/simulate`, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "TEMPLATE_SIMULATION_UNAVAILABLE",
        traceId: "e2e-stub-trace",
        reasonCode: "TEMPLATE_SIMULATION_UNAVAILABLE",
      }),
    });
  });

  await page.getByTestId("tpladmin-editor-simulate-toggle").click();
  await expect(page.getByTestId("tpladmin-editor-simulate-dialog")).toBeVisible();
  await page.getByTestId("tpladmin-editor-simulate-input").fill("帮我画一份用户画像");
  await page.getByTestId("tpladmin-editor-simulate-run").click();

  // 诚实错误提示出现，且是契约点名的那句人话（不是"undefined"或裸 JSON）。
  await expect(page.getByTestId("tpladmin-editor-simulate-error")).toBeVisible();
  await expect(page.getByTestId("tpladmin-editor-simulate-error")).toContainText("模型暂时调不通");
  // 运行按钮回到可点状态——没有卡在"运行中…"转圈（诚实失败必须能重试，不是死锁）。
  await expect(page.getByTestId("tpladmin-editor-simulate-run")).toHaveText("运行");
  await expect(page.getByTestId("tpladmin-editor-simulate-run")).toBeEnabled();
  // 没有半渲染出一个空/坏画布——失败态就该没有结果区。
  await expect(page.getByTestId("tpladmin-editor-simulate-result")).toHaveCount(0);
});
