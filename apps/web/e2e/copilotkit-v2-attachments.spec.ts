import { test, expect } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * chat-parity-attachments（issue #2022，差距清单第 2 项，阻断级）—— 真实浏览器证明
 * `/chat` 的附件上传不是"上传成功、UI 显示已就绪，但 agent 从来看不到
 * 这个附件内容"的假功能。
 *
 * ## 取证链路，与 `chat-attachment-image-vision-extraction.spec.ts`（旧轨道）同一套纪律
 *
 * 上传/消息响应都不携带 `extraction_status`/`extracted_excerpt`（`chat-file-upload.ts`
 * 的 `Attachment` 契约只有 `{id, filename, mime, bytes, createdAt}`）——没有任何 HTTP 面
 * 直接暴露"抽取到的内容"。真正能观测到"内容真的进了模型上下文"的信号，只有一条：
 * `execute-run.ts` 的 `withAttachmentNotice` 把抽取摘录拼进发给模型的 `content`，
 * `loopback-deep-agent-provider.ts` 的默认剧本把它收到的 `userText`**逐字回显**进最终
 * 回复（`根据查询结果回答你："${userText}" ——`，见该脚本头注"回显用户原文"）——
 * 上传一个内容里带唯一标记字符串的 `.txt` 文件，发一条消息，断言助手回复里出现了这个
 * 标记字符串，就是"附件内容真的被模型看到过"唯一可信的浏览器可观测证据。
 *
 * `.txt`（`text/plain`）走 `planExtraction` 的 `passthrough` 计划——字节本身即内容，
 * 且 ≤ `ATTACHMENT_SYNC_EXTRACTION_MAX_BYTES`（3MB）走**上传请求内联同步抽取**
 * （`attachment-extraction.ts` 头注），不依赖任何外部视觉/anydoc 服务，也不需要等待
 * 一个异步 worker 的不确定延迟——选它是为了让这条 e2e 确定性强、不依赖真实上游 key
 * （与 `chat-attachment-image-vision-extraction.spec.ts` 选择"断言诚实降级路径"是
 * 同一种"不在 e2e 里往真实外网/真实模型凭据上赌"的纪律，只是这里恰好能拿到真实
 * `extracted` 终态而不必退回降级分支）。
 */

test.setTimeout(120_000);

async function login(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);
}

async function warmUpCopilotRuntimeRoute(page: import("@playwright/test").Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/api/copilotkit/info");
        return res.status();
      },
      { timeout: 60_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(200);
}

const MARKER = `ATTACH-E2E-MARKER-${Date.now().toString(36)}`;
const FILE_CONTENT = `这是一份 e2e 上传的纯文本附件。\n唯一标记：${MARKER}\n用于证明附件内容真的到达了 agent。`;
const FILE_NAME = "copilotkit-v2-attachment-fixture.txt";

test(
  "chat-parity-attachments：真实浏览器上传附件 → 发消息引用它 → 助手回复体现出真看到了附件内容",
  async ({ page }) => {
    await warmUpCopilotRuntimeRoute(page);
    await login(page);
    await page.goto("/chat");

    /* ═══════════ ① 📎 入口从零到有——先前差距清单第 2 项的核心断言 ═══════════ */

    const attachButton = page.getByTestId("chat-attachment-input");
    await expect(attachButton).toBeVisible();
    // 附件专用线程是挂载后异步创建的（issue #2022 文件头"上传要有一个真实的
    // chat_threads 行"一节）——按钮在那之前保持禁用，不是一上来就能点开一个必然
    // 404 的上传请求。
    await expect.poll(async () => attachButton.isDisabled(), { timeout: 20_000 }).toBe(false);

    /* ═══════════ ② 真实选文件 → 真实 multipart 上传 → 201 ═══════════ */

    await attachButton.click();
    await expect(page.getByTestId("chat-attach-material-portal")).toBeVisible();

    const uploadResponsePromise = page.waitForResponse((response) => (
      response.request().method() === "POST"
      && /\/chat\/threads\/[^/]+\/attachments$/.test(new URL(response.url()).pathname)
    ));
    await page.getByTestId("chat-attachment-file-input").setInputFiles({
      name: FILE_NAME,
      mimeType: "text/plain",
      buffer: Buffer.from(FILE_CONTENT, "utf8"),
    });

    const uploadResponse = await uploadResponsePromise;
    expect(uploadResponse.status()).toBe(201);
    const uploaded = await uploadResponse.json() as { id: string; filename: string; mime: string };
    expect(uploaded.filename).toBe(FILE_NAME);
    expect(uploaded.mime).toBe("text/plain");

    const chip = page.locator('[data-testid^="chat-attach-material-att-chip-"]');
    await expect(chip).toHaveAttribute("data-status", "uploaded");
    await expect(chip).toContainText("已就绪");

    await page.getByTestId("chat-attach-material-confirm").click();
    await expect(page.getByTestId("chat-attach-material-portal")).toHaveCount(0);
    // composer 附件预览条（面板外层，不是「加材料」弹窗内那份列表）也应该看到这个文件。
    await expect(page.getByTestId("chat-attachment-list")).toContainText(FILE_NAME);

    /* ═══════════ ③ 带着这个附件发一条消息，真实打一次 agent run ═══════════ */

    const promptText = "这个附件里写的是什么？";
    await page.getByTestId("copilotkit-v2-input").fill(promptText);
    await page.getByTestId("copilotkit-v2-send").click();

    // 发送后 composer 的 pending 附件预览条应该清空（issue #2022：已发出的附件从
    // composer 移走，同旧轨道语义）。
    await expect(page.getByTestId("chat-attachment-list")).toHaveCount(0);

    /* ═══════════ ④ 核心断言：助手回复里出现了附件唯一标记——证明内容真的到达了模型 ═══════════ */

    const messages = page.getByTestId("copilotkit-v2-messages");
    await expect(messages).toContainText(promptText, { timeout: 30_000 });
    // deep-agent loopback 默认剧本逐字回显它收到的 userText（见文件头"取证链路"一段）；
    // userText 由 `withAttachmentNotice` 拼上了这个附件的抽取摘录——摘录里包含
    // FILE_CONTENT，FILE_CONTENT 里包含 MARKER。断言 MARKER 而不是整段 FILE_CONTENT：
    // 更抗 UI 渲染层面的空白/换行归一化差异，同样具备唯一性、不会被泛用兜底文案偶然撞上。
    await expect(messages).toContainText(MARKER, { timeout: 30_000 });
    // 反向对照：如果抽取管线没被真正触发（例如本任务只做了"上传"没打通
    // attachmentIds 透传），回复只会是泛用兜底文案，不会包含这个此前从未出现过的
    // 随机标记——这条会如实变红，而不是静默通过。
  },
);
