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
  await page.goto("/canvas?screen=template-admin&view=list");
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
  await page.goto("/canvas?screen=template-admin&view=list");
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
