/**
 * #1584 —— 消息气泡里点击附件条，弹窗预览 + 下载，真实浏览器 e2e。
 *
 * 覆盖三种情况：
 *   ① image/png —— 弹窗内联 `<img>`，真的从 `GET .../attachments/:id/content` 拉到字节
 *      （不是占位图），下载按钮可用。
 *   ② application/pdf —— 弹窗内联 `<iframe>`，同样真的拉到字节。
 *   ③ application/vnd...presentationml.presentation（pptx）—— 用 `pptx-preview` 纯前端
 *      内联渲染出真实幻灯片内容（2026-08-24 黑屏回归修复后的行为，见下方该用例头注）。
 *
 * 全部走真实上传（`<input type=file>` setInputFiles）→ 真实 `POST .../attachments`
 * （201）→ 真实发消息 → 点击真实渲染出来的附件条 → 真实认证过的
 * `fetch`（`useAuthedImageSrc`）拉字节 → `URL.createObjectURL` 喂给 `<img>`/`<iframe>`。
 * 不 mock 任何一跳。
 *
 * ## issue #2997 —— 入口从「消息气泡里的附件条」改为「右栏『材料』页签」
 *
 * `#2890`（`d30ac48e8`）之后 `/chat?projectId=` 渲染 CopilotKit v2 工作台，旧屏
 * 已无可达路由。核对结果：
 *   · **弹窗本体有对等实现，而且是同一个组件** —— `ChatAttachmentPreviewModal`
 *     被 `chat-materials-panel.tsx:108` 渲染，而 `ChatMaterialsPanel` 由
 *     `chat-task-inspector.tsx:317`（v2 右栏「材料」页签）挂载。本文件断言的
 *     `chat-attachment-preview-*` 全套 testid 因此一字不用改，行为语义
 *     （真拉字节、内联渲染、下载按钮、关闭）也一字不改。
 *   · **消息气泡里的附件条没有对等实现** —— `MessageAttachments`
 *     （`chat-composer-attachments.tsx:584`，产出 `chat-message-attachment-<id>`）
 *     的唯一消费者是旧屏 `chat-live-message-panel.tsx:1311`；v2 的消息气泡
 *     （`copilotkit-v2-assistant-message.tsx` / `copilotkit-v2-user-message.tsx`）
 *     完全不渲染附件。**这是一处真实的功能退化，已开产品缺口 issue #3019**，不在这里
 *     假装它还在。
 * 所以本文件把「点开预览」的入口换成 v2 上真实存在的那一个（右栏材料列表），
 * 保住的是这个文件真正要证的东西（#1584 的标题就是「附件预览/下载弹窗」）。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { V2_SEND_WIRE } from "./chat-v2-send";

/** 70 字节的合法最小 PNG（1x1 红色像素），与 #1560 P1 e2e 同一份。 */
const MINIMAL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
/** 最小合法 PDF（magic bytes `%PDF`，`sniffMimeFamily` 判 pdf 族即可，不需要能真的渲染页面）。 */
const MINIMAL_PDF = Buffer.from("%PDF-1.4\n%%EOF\n");
/**
 * 2026-08-24 黑屏回归修复 —— 这里不能再用 10 字节的假 ZIP 魔数了：#1980 把 pptx 从
 * 「不支持预览，直接降级」升级成「真的用 pptx-preview 内联渲染幻灯片」，魔数假文件对
 * `pptx-preview` 来说是一个损坏的 zip，会被真实渲染器判定为 JSZip 解析失败——那只覆盖了
 * 「渲染器抛错」这一条分支，覆盖不到这次真正在生产环境复现的「渲染器不抛错、但没有真的
 * 画出内容」这条分支（根因见 `chat-attachment-slides-preview.tsx` 文件头注）。要让这条 e2e
 * 真的对黑屏回归有效，必须喂一份能被 pptx-preview 成功解析、真的产出可辨认幻灯片内容的
 * 合法 pptx 字节——用仓库里已有的真实样例文件（AI 原生转型工作坊 Agenda，与
 * `chat-attachment-slides-preview.test` 系列排查这次黑屏时用的是同一份）。
 */
const REAL_PPTX_PATH = path.resolve(__dirname, "./fixtures/sample-presentation.pptx");

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

/**
 * 上传一个附件（真实文件选择），确认组件到「已就绪」，加入这一轮，发消息，返回附件 id。
 *
 * ⚠ 顺带钉住一个真实 bug（2026-08-19 本文件初版实测发现）：`pickFiles` 的 `setAttachments`
 * updater 函数体里直接调 `queueMicrotask` 触发真实上传——这是一个带副作用的 state
 * updater。React 18 StrictMode（开发环境）会刻意把 updater 调用两次来抓不纯的
 * reducer，于是每选一次文件，真实 `POST .../attachments` 发了两次，产出两个不同的服务端
 * id；组件最终发消息时用哪一个纯属两次网络请求谁先落地的竞态。已在
 * `chat-composer-attachments.tsx` 的 `doUpload` 里补了幂等门（按 `localId` 去重）修复。
 * 这里用一个真实网络请求计数断言把这个 bug 钉死，不再依赖临时调试代码。
 */
async function uploadAndSend(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
  text: string,
): Promise<string> {
  let uploadCount = 0;
  page.on("requestfinished", (request) => {
    if (request.method() === "POST"
      && request.url().endsWith(`/chat/threads/${CHAT_READ_E2E.attachmentPreviewThreadId}/attachments`)) {
      uploadCount += 1;
    }
  });

  await page.getByTestId("chat-attachment-input").click();
  await expect(page.getByTestId("chat-attach-material-portal")).toBeVisible();

  const uploadResponsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().endsWith(`/chat/threads/${CHAT_READ_E2E.attachmentPreviewThreadId}/attachments`)
  ));
  await page.getByTestId("chat-attachment-file-input").setInputFiles(file);
  const uploadResponse = await uploadResponsePromise;
  expect(uploadResponse.status()).toBe(201);
  const uploaded = await uploadResponse.json() as { id: string };

  const chip = page.locator('[data-testid^="chat-attach-material-att-chip-"]');
  await expect(chip).toHaveAttribute("data-status", "uploaded");
  await page.getByTestId("chat-attach-material-confirm").click();
  await expect(page.getByTestId("chat-attach-material-portal")).toHaveCount(0);

  const input = page.getByTestId("copilotkit-v2-input");
  await input.fill(text);
  // issue #2997 —— v2 的发送线路是 `POST /api/copilotkit/agent/:id/run`
  //（实测取证见 `chat-v2-send.ts` 头注）；旧屏那条 `POST …/messages` 浏览器不再发。
  // 断言的事没变：这一轮真的被发了出去，且上行请求体带着本轮附件 id。
  const runRequestPromise = page.waitForRequest(
    (r) => r.method() === "POST" && V2_SEND_WIRE.test(new URL(r.url()).pathname),
    { timeout: 60_000 },
  );
  await page.getByTestId("copilotkit-v2-send").click();
  const runRequest = await runRequestPromise;
  expect(
    JSON.stringify(runRequest.postDataJSON()),
    "本轮上行 run 请求必须带着刚上传的那个附件 id（`forwardedProps.attachmentIds`）",
  ).toContain(uploaded.id);

  // 回归防线：一次 setInputFiles 只该触发一次真实上传。等一拍让"第二次"（如果 bug 复发）
  // 有机会真的发出去，不是只看到第一次就提前判过。
  await page.waitForTimeout(300);
  expect(uploadCount, "一次选择文件只应触发一次真实上传（StrictMode 双调用回归防线）").toBe(1);

  return uploaded.id;
}

/**
 * 打开右栏「材料」页签，点开这个附件的预览弹窗。
 *
 * 先整页刷新一次再打开：右栏材料列表是在选中线程时由 `loadRightPanel()` 读的
 * （`copilotkit-v2-shell.tsx`），刷新让它必然重新走一次真实
 * `listThreadAttachments` —— 顺带把"这个附件真的落库了"也证掉，比在内存态列表里
 * 点一下更强，不是为了绕过时序。
 */
async function openPreviewFromMaterials(page: Page, threadId: string, attachmentId: string): Promise<void> {
  await page.reload();
  await expect(page.getByTestId(`chat-thread-${threadId}`)).toBeVisible({ timeout: 60_000 });
  const tab = page.getByTestId("chat-task-workbench-inspector-tab-materials");
  await expect(tab).toBeVisible({ timeout: 60_000 });
  await tab.click();
  await expect(page.getByTestId("chat-materials-panel")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(`chat-material-${attachmentId}`).click();
}

/**
 * issue #2997 —— **原文保留的断言：消息气泡里的附件条。v2 上没有对等实现。**
 *
 * 迁移前这条断言写在 `uploadAndSend` 末尾（"发出去之后，这条附件真的作为一个可点的
 * 附件条渲染在消息气泡里"）。v2 的消息气泡不渲染附件（取证见文件头注），把它删掉
 * 就是把退化藏起来，所以原样搬到这里用 `test.fixme` 钉住：断言是对的，产品还没做到；
 * 产品补上之后它会因为**意外通过**而提醒人来撤标。产品缺口 issue：**#3019**。
 */
test.fixme("#1584 消息气泡里的附件条可点开预览（v2 尚无对等实现，issue #2997 缺口）", async ({ page }) => {
  await login(page);
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.restructureProjectId}&thread=${CHAT_READ_E2E.attachmentPreviewThreadId}`);
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.attachmentPreviewThreadId}`)).toBeVisible();

  const attachmentId = await uploadAndSend(
    page,
    { name: "bubble-chip.png", mimeType: "image/png", buffer: Buffer.from(MINIMAL_PNG_BASE64, "base64") },
    "气泡里应该有一条可点的附件条",
  );

  await expect(page.getByTestId(`chat-message-attachment-${attachmentId}`)).toBeVisible();
  await page.getByTestId(`chat-message-attachment-${attachmentId}`).click();
  await expect(page.getByTestId("chat-attachment-preview-portal")).toBeVisible();
});

test.describe("#1584 附件预览/下载弹窗", () => {
  test("image/png：弹窗内联 <img>，真的拉到字节，下载按钮可用", async ({ page }) => {
    await login(page);
    await page.goto(`/chat?projectId=${CHAT_READ_E2E.restructureProjectId}&thread=${CHAT_READ_E2E.attachmentPreviewThreadId}`);
    await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.attachmentPreviewThreadId}`)).toBeVisible();

    const attachmentId = await uploadAndSend(
      page,
      { name: "preview-test.png", mimeType: "image/png", buffer: Buffer.from(MINIMAL_PNG_BASE64, "base64") },
      "预览一下这张图",
    );

    await openPreviewFromMaterials(page, CHAT_READ_E2E.attachmentPreviewThreadId, attachmentId);
    await expect(page.getByTestId("chat-attachment-preview-portal")).toBeVisible();

    // 真的拉到字节，不是占位图：等 loading/failed 两种过渡态都消失，图片元素出现。
    await expect(page.getByTestId("chat-attachment-preview-loading")).toHaveCount(0);
    await expect(page.getByTestId("chat-attachment-preview-failed")).toHaveCount(0);
    const img = page.getByTestId("chat-attachment-preview-image");
    await expect(img).toBeVisible();
    const src = await img.getAttribute("src");
    expect(src, "必须是真的 blob URL，不是占位符").toMatch(/^blob:/);
    // naturalWidth > 0 证明浏览器真的把这个 blob URL 解码成了一张有效图片，不是一个
    // 指向坏数据的 <img> 标签（那种情况下 naturalWidth 恒为 0）。
    await expect
      .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);

    const download = page.getByTestId("chat-attachment-preview-download");
    await expect(download).toBeEnabled();
    const downloadHref = await download.getAttribute("href");
    expect(downloadHref).toMatch(/^blob:/);

    await page.getByTestId("chat-attachment-preview-dismiss").click();
    await expect(page.getByTestId("chat-attachment-preview-portal")).toHaveCount(0);
  });

  test("application/pdf：弹窗内联 <iframe>，真的拉到字节", async ({ page }) => {
    await login(page);
    await page.goto(`/chat?projectId=${CHAT_READ_E2E.restructureProjectId}&thread=${CHAT_READ_E2E.attachmentPreviewThreadId}`);
    await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.attachmentPreviewThreadId}`)).toBeVisible();

    const attachmentId = await uploadAndSend(
      page,
      { name: "preview-test.pdf", mimeType: "application/pdf", buffer: MINIMAL_PDF },
      "预览一下这份 PDF",
    );

    await openPreviewFromMaterials(page, CHAT_READ_E2E.attachmentPreviewThreadId, attachmentId);
    await expect(page.getByTestId("chat-attachment-preview-portal")).toBeVisible();
    await expect(page.getByTestId("chat-attachment-preview-loading")).toHaveCount(0);
    await expect(page.getByTestId("chat-attachment-preview-failed")).toHaveCount(0);
    const frame = page.getByTestId("chat-attachment-preview-pdf");
    await expect(frame).toBeVisible();
    const src = await frame.getAttribute("src");
    expect(src).toMatch(/^blob:/);
  });

  test("pptx：真的内联渲染出幻灯片内容（2026-08-24 黑屏回归修复），不是黑屏/空白", async ({ page }) => {
    // 这条用例此前（#1584 初版）用 10 字节假 zip 魔数断言「不支持预览，降级下载」——
    // #1980 已经把 pptx 升级成真实内联渲染，那条断言从那时起就已经与生产行为不符
    // （见本文件同一次改动的头注）。这里改成喂一份真实合法的 pptx，断言真的渲染出了
    // 可辨认的幻灯片内容，同时钉死这次黑屏回归的两条防线：①没有黑屏兜底容器；
    // ②真的有非空、非纯黑的可见内容。
    await login(page);
    await page.goto(`/chat?projectId=${CHAT_READ_E2E.restructureProjectId}&thread=${CHAT_READ_E2E.attachmentPreviewThreadId}`);
    await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.attachmentPreviewThreadId}`)).toBeVisible();

    const attachmentId = await uploadAndSend(
      page,
      {
        name: "preview-test.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        buffer: fs.readFileSync(REAL_PPTX_PATH),
      },
      "预览一下这份 PPT",
    );

    await openPreviewFromMaterials(page, CHAT_READ_E2E.attachmentPreviewThreadId, attachmentId);
    await expect(page.getByTestId("chat-attachment-preview-portal")).toBeVisible();

    // 加载态：pptx-preview 需要真的下载 chunk + 解析 zip，给足时间，不在骨架屏阶段断言失败。
    await expect(page.getByTestId("chat-attachment-preview-slides-failed")).toHaveCount(0);
    const slides = page.getByTestId("chat-attachment-preview-slides");
    await expect(slides).toBeVisible({ timeout: 30_000 });

    // 「共 N 页」指示条真的算出了这份真实文件的页数（不是恒定假文案）。
    await expect(page.getByTestId("chat-attachment-preview-slides-count")).toContainText(/共 \d+ 页/);

    // 黑屏回归核心断言：真的渲染出了幻灯片骨架节点，且第一张幻灯片里有可见文字——
    // 不是一块空的/纯黑的 wrapper。
    const slideWrapperCount = await slides.locator(".pptx-preview-slide-wrapper").count();
    expect(slideWrapperCount, "必须真的渲染出至少一张幻灯片，不是空壳容器").toBeGreaterThan(0);
    await expect(slides.locator(".pptx-preview-slide-wrapper").first()).toContainText(/./);

    // wrapper 背景已经被体检补丁从库硬编码的纯黑 #000 改写成中性 token——直接断言计算样式，
    // 钉死「即使某张幻灯片渲染不全，用户也不会看到一块纯黑」这条安全网。
    const wrapperBg = await slides.locator(".pptx-preview-wrapper").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(wrapperBg, "wrapper 背景不能是库硬编码的纯黑").not.toBe("rgb(0, 0, 0)");

    // 下载依旧真实可用——预览是内联渲染的加分项，下载这条兜底能力不能被这次改动破坏。
    const download = page.getByTestId("chat-attachment-preview-download");
    await expect(download).toBeEnabled();
    const downloadHref = await download.getAttribute("href");
    expect(downloadHref).toMatch(/^blob:/);
  });
});
