/**
 * #1584 —— 消息气泡里点击附件条，弹窗预览 + 下载，真实浏览器 e2e。
 *
 * 覆盖三种情况：
 *   ① image/png —— 弹窗内联 `<img>`，真的从 `GET .../attachments/:id/content` 拉到字节
 *      （不是占位图），下载按钮可用。
 *   ② application/pdf —— 弹窗内联 `<iframe>`，同样真的拉到字节。
 *   ③ application/vnd...presentationml.presentation（pptx）—— 没有可靠的离线内联渲染器，
 *      降级成「不支持预览，请下载查看」+ 下载按钮，不是空白或报错。
 *
 * 全部走真实上传（`<input type=file>` setInputFiles）→ 真实 `POST .../attachments`
 * （201）→ 真实发消息 → 消息气泡里点击真实渲染出来的附件条 → 真实认证过的
 * `fetch`（`useAuthedImageSrc`）拉字节 → `URL.createObjectURL` 喂给 `<img>`/`<iframe>`。
 * 不 mock 任何一跳。
 */
import { expect, test, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/** 70 字节的合法最小 PNG（1x1 红色像素），与 #1560 P1 e2e 同一份。 */
const MINIMAL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
/** 最小合法 PDF（magic bytes `%PDF`，`sniffMimeFamily` 判 pdf 族即可，不需要能真的渲染页面）。 */
const MINIMAL_PDF = Buffer.from("%PDF-1.4\n%%EOF\n");
/** 最小 ZIP 容器（magic bytes `PK\\x03\\x04`）——pptx/docx/xlsx 在字节嗅探层面同族。 */
const MINIMAL_PPTX = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00]);

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
      && request.url().endsWith(`/chat/threads/${CHAT_READ_E2E.imageVisionThreadId}/attachments`)) {
      uploadCount += 1;
    }
  });

  await page.getByTestId("chat-attachment-input").click();
  await expect(page.getByTestId("chat-attach-material-portal")).toBeVisible();

  const uploadResponsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().endsWith(`/chat/threads/${CHAT_READ_E2E.imageVisionThreadId}/attachments`)
  ));
  await page.getByTestId("chat-attachment-file-input").setInputFiles(file);
  const uploadResponse = await uploadResponsePromise;
  expect(uploadResponse.status()).toBe(201);
  const uploaded = await uploadResponse.json() as { id: string };

  const chip = page.locator('[data-testid^="chat-attach-material-att-chip-"]');
  await expect(chip).toHaveAttribute("data-status", "uploaded");
  await page.getByTestId("chat-attach-material-confirm").click();
  await expect(page.getByTestId("chat-attach-material-portal")).toHaveCount(0);

  const input = page.getByRole("textbox", { name: "消息内容" });
  await input.fill(text);
  const messageResponsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().endsWith(`/chat/threads/${CHAT_READ_E2E.imageVisionThreadId}/messages`)
  ));
  await page.getByTestId("chat-message-submit").click();
  const messageResponse = await messageResponsePromise;
  expect(messageResponse.status()).toBe(202);

  // 回归防线：一次 setInputFiles 只该触发一次真实上传。等一拍让"第二次"（如果 bug 复发）
  // 有机会真的发出去，不是只看到第一次就提前判过。
  await page.waitForTimeout(300);
  expect(uploadCount, "一次选择文件只应触发一次真实上传（StrictMode 双调用回归防线）").toBe(1);

  await expect(page.getByTestId(`chat-message-attachment-${uploaded.id}`)).toBeVisible();
  return uploaded.id;
}

test.describe("#1584 附件预览/下载弹窗", () => {
  test("image/png：弹窗内联 <img>，真的拉到字节，下载按钮可用", async ({ page }) => {
    await login(page);
    await page.goto(`/chat?projectId=${CHAT_READ_E2E.restructureProjectId}&thread=${CHAT_READ_E2E.imageVisionThreadId}`);
    await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.imageVisionThreadId}`)).toBeVisible();

    const attachmentId = await uploadAndSend(
      page,
      { name: "preview-test.png", mimeType: "image/png", buffer: Buffer.from(MINIMAL_PNG_BASE64, "base64") },
      "预览一下这张图",
    );

    await page.getByTestId(`chat-message-attachment-${attachmentId}`).click();
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
    await page.goto(`/chat?projectId=${CHAT_READ_E2E.restructureProjectId}&thread=${CHAT_READ_E2E.imageVisionThreadId}`);
    await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.imageVisionThreadId}`)).toBeVisible();

    const attachmentId = await uploadAndSend(
      page,
      { name: "preview-test.pdf", mimeType: "application/pdf", buffer: MINIMAL_PDF },
      "预览一下这份 PDF",
    );

    await page.getByTestId(`chat-message-attachment-${attachmentId}`).click();
    await expect(page.getByTestId("chat-attachment-preview-portal")).toBeVisible();
    await expect(page.getByTestId("chat-attachment-preview-loading")).toHaveCount(0);
    await expect(page.getByTestId("chat-attachment-preview-failed")).toHaveCount(0);
    const frame = page.getByTestId("chat-attachment-preview-pdf");
    await expect(frame).toBeVisible();
    const src = await frame.getAttribute("src");
    expect(src).toMatch(/^blob:/);
  });

  test("pptx：不支持内联预览，如实降级成提示 + 可用的下载按钮（不是空白/报错）", async ({ page }) => {
    await login(page);
    await page.goto(`/chat?projectId=${CHAT_READ_E2E.restructureProjectId}&thread=${CHAT_READ_E2E.imageVisionThreadId}`);
    await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.imageVisionThreadId}`)).toBeVisible();

    const attachmentId = await uploadAndSend(
      page,
      {
        name: "preview-test.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        buffer: MINIMAL_PPTX,
      },
      "预览一下这份 PPT",
    );

    await page.getByTestId(`chat-message-attachment-${attachmentId}`).click();
    await expect(page.getByTestId("chat-attachment-preview-portal")).toBeVisible();
    await expect(page.getByTestId("chat-attachment-preview-unsupported")).toContainText("不支持预览，请下载查看");
    // 降级归降级，下载依旧真实可用——字节已经拉到了本地 blob，只是没有内联渲染器。
    const download = page.getByTestId("chat-attachment-preview-download");
    await expect(download).toBeEnabled();
    const downloadHref = await download.getAttribute("href");
    expect(downloadHref).toMatch(/^blob:/);
  });
});
