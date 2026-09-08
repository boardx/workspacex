/**
 * #1560 P1 —— 图片附件走 VLM 视觉理解的真实浏览器 e2e。
 *
 * PR #1564 只有后端 vitest（`apps/api/tests/chat/attachment-upload.test.ts`），没有任何真实
 * 浏览器证据：真实文件选择/拖拽走真实上传端点、真实抽取管线被真的触发。本文件补这一段。
 *
 * ## 本机没有真实百炼视觉 key——测的是诚实降级路径，不是「识图真的成功了」
 *
 * 证明「图片描述正确」需要真实上游 key，本仓不具备也不该在 e2e 里造假。这里证明的是
 * `attachment-extraction-worker.ts` / `bailian-vision-extractor.ts` 记录的降级契约：
 *   1. 上传一张真实 PNG（走真实浏览器文件选择 → multipart → 真实 `POST .../attachments`），
 *      附件真被接受（201，UI 上出现「已就绪」的附件卡片）。
 *   2. 抽取管线真被触发、真走到终态——`extraction_status` 落 `failed`，
 *      `extraction_error` 落 `visionNotConfigured`（`classifyHttpFailure` 对 401 的判定；
 *      本链路的视觉上游是 `loopback-vision-provider.ts`，对任何请求都如实回 401
 *      `InvalidApiKey`，见该脚本与 `playwright.chat-read.config.ts` 里 `KERNEL_VISION_BASE_URL`
 *      的头注——不依赖真实外网，但走的是与「无 key」逐字相同的分类代码路径）。
 *   3. UI 不会假装「已读取图片内容」——`chat-composer-attachments.tsx` 的已上传徽标只写
 *      「已就绪」（上传态），从未渲染任何抽取/识图结果；这里额外断言消息气泡下的只读附件展示
 *      （`MessageAttachments`）同样只有文件名/大小，没有转录或描述文本。
 *
 * ## 2026-08-19 观测：负载噪音复盘，非本 spec 回归
 *
 * 当天以 `pnpm run verify:chat-read`（跑 config 里全部 spec）连续两次跑本用例均超时失败
 * （`getByTestId('chat-message-attachment-...')` 30s 未见），当时 `uptime` load average
 * 均在 10–12（本机 10 核）。随后单独隔离重跑本 spec（`playwright test ... chat-attachment-
 * image-vision-extraction.spec.ts`，1 worker），load 已回落到 3.25–4.3，稳定通过
 * （19.8s，总计 51.5s）。结论：本次是负载导致的假红，不是本 spec 或其覆盖链路的真实回归；
 * 未改动测试逻辑。
 *
 * ## 终态如何在浏览器侧取证，而不是直连 DB
 *
 * 附件上传响应（契约 `Attachment`）与消息列表都不携带 `extraction_status`/`extraction_error`
 * 字段（`packages/contracts/src/chat-file-upload.ts`——这本身是 #1558 记录的真实产品缺口：
 * 没有任何 HTTP 面把抽取终态暴露给前端）。但 `execute-run.ts` 的 `withAttachmentNotice` /
 * `renderAttachmentForModel` 会把**触发这次 run 的消息**的附件抽取状态渲染成一段中性提示
 * 拼进发给模型的 `content`（`failed` → 「内容提取失败，无法读取其内容」），而
 * `loopback-model-provider.ts` 会把它收到的 user content 原样回显进回复——这条回显链路已被
 * `chat-agent-skill-context.spec.ts` 的 F155 用例验证过是真实穿过整条链的证据，不是前端合成。
 * 这里复用同一条取证纪律：发一条带图片附件的消息，读**助手回复**里是否出现那句降级提示，
 * 是"抽取真走到 failed 终态、且真被读进了 run 组装"的浏览器可观测信号——不直连 DB。
 */
import { expect, test, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { bearerOf, listPersistedMessages, snapshotMessageIds, awaitAssistantReply, V2_SEND_WIRE } from "./chat-v2-send";
import { SESSION_TOKEN_STORAGE_KEY } from "../lib/api-client";

/** 70 字节的合法最小 PNG（1x1 红色像素），magic number 与服务端 `sniffMimeFamily` 的 png 族匹配。 */
const MINIMAL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const IMAGE_FILENAME = "chat-read-e2e-vision-p1.png";

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function authHeaders(page: Page): Promise<Record<string, string>> {
  const token = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_TOKEN_STORAGE_KEY);
  expect(token, "登录之后 localStorage 里应有 session token").toBeTruthy();
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

test(
  "F153/#1560 P1：真实浏览器上传图片附件走 VLM，本机无视觉 key → 诚实降级为 failed，"
  + "不假装已读取图片内容",
  async ({ page }) => {
    await login(page);
    await page.goto(`/chat?projectId=${CHAT_READ_E2E.restructureProjectId}&thread=${CHAT_READ_E2E.imageVisionThreadId}`);
    await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.imageVisionThreadId}`))
      .toContainText("Image vision extraction fixture thread");

    /* ═══════════ ① 真实浏览器选文件 → 真实 multipart 上传 → 201 ═══════════ */

    // 「加材料进这一轮」面板：点 📎 打开，再点「从本机文件选择」触发隐藏 input。
    await page.getByTestId("chat-attachment-input").click();
    await expect(page.getByTestId("chat-attach-material-portal")).toBeVisible();

    const uploadResponsePromise = page.waitForResponse((response) => (
      response.request().method() === "POST"
      && response.url().endsWith(`/chat/threads/${CHAT_READ_E2E.imageVisionThreadId}/attachments`)
    ));
    // 隐藏 input 由 `ctl.openFileDialog`（面板里「从本机文件选择」按钮）驱动打开系统选择框；
    // Playwright 直接对这个真实 <input type=file> 调 setInputFiles 走的就是浏览器真实的
    // 文件选择路径（不是伪造一次 change 事件），随后组件自身的 `pickFiles` → `doUpload`
    // 触发真实 `fetch`/multipart 上传，不是本文件在拦截。
    await page.getByTestId("chat-attachment-file-input").setInputFiles({
      name: IMAGE_FILENAME,
      mimeType: "image/png",
      buffer: Buffer.from(MINIMAL_PNG_BASE64, "base64"),
    });

    const uploadResponse = await uploadResponsePromise;
    expect(uploadResponse.status(), "真实上传应该 201：附件本身与视觉抽取是否成功无关").toBe(201);
    const uploaded = await uploadResponse.json() as { id: string; filename: string; mime: string };
    expect(uploaded.filename).toBe(IMAGE_FILENAME);
    expect(uploaded.mime).toBe("image/png");

    // UI 侧：附件卡片进入「已就绪」态——**不是**「已提取」/「已识别」之类的措辞。上传态与抽取态
    // 是两件独立的事：`chat-composer-attachments.tsx` 的 `LiveAttachment` 状态机压根不携带任何
    // 抽取/识图字段（只有 uploading/uploaded/error），这条断言把这一点钉在浏览器可见文本上。
    const chip = page.locator('[data-testid^="chat-attach-material-att-chip-"]');
    await expect(chip).toHaveAttribute("data-status", "uploaded");
    await expect(chip).toContainText("已就绪");
    await expect(chip).not.toContainText("已提取");
    await expect(chip).not.toContainText("已识别");

    await page.getByTestId("chat-attach-material-confirm").click();
    await expect(page.getByTestId("chat-attach-material-portal")).toHaveCount(0);

    /* ═══════════ ② 带着这个附件发一条消息，触发一次真实 agent run ═══════════ */

    /*
     * issue #2997 —— `#2890` 之后 `/chat?projectId=` 渲染的是 CopilotKit v2 工作台，
     * 旧屏已无可达路由。三处换掉，理由与取证见 `chat-v2-send.ts` 头注：
     *   ① `getByRole("textbox", { name: "消息内容" })` —— v2 的 `<textarea>` 无
     *      `aria-label`（真栈探针实测 `ariaLabel: null`），换 `copilotkit-v2-input`；
     *   ② `POST /chat/threads/:id/messages`（202 + runId）—— v2 走
     *      `POST /api/copilotkit/agent/:id/run`，runId 改从落库投影读；
     *   ③ 消息气泡里的只读附件展示（`chat-message-attachment-<id>`）—— **v2 完全
     *      不渲染**（`MessageAttachments` 唯一消费者是旧屏
     *      `chat-live-message-panel.tsx:1311`）。这是一处真实的功能退化，产品缺口
     *      issue **#3019**；断言原文保留在文件末尾的 `test.fixme` 里，不删、不改宽。
     */
    const bearer = await bearerOf(page);
    const knownIds = await snapshotMessageIds(page, CHAT_READ_E2E.imageVisionThreadId, bearer);

    const input = page.getByTestId("copilotkit-v2-input");
    await expect(input).toBeVisible({ timeout: 60_000 });
    const promptText = "这张图里写了什么？";
    await input.fill(promptText);

    const runRequestPromise = page.waitForRequest(
      (r) => r.method() === "POST" && V2_SEND_WIRE.test(new URL(r.url()).pathname),
      { timeout: 60_000 },
    );
    await page.getByTestId("copilotkit-v2-send").click();
    const runRequest = await runRequestPromise;
    expect(
      JSON.stringify(runRequest.postDataJSON()),
      "本轮上行 run 请求必须带着刚上传的那个附件 id",
    ).toContain(uploaded.id);

    const replyMessage = await awaitAssistantReply(page, CHAT_READ_E2E.imageVisionThreadId, bearer, knownIds, 90_000);
    const accepted = { agentRunId: replyMessage.agentRunId! };

    /* ═══════════ ③ 等 run 到终态，读助手回复：抽取真的走到了 failed ═══════════ */

    // issue #2997 —— v2 没有权威 run 状态条，也没有行级 `data-message-id` 锚点。
    // 回复本身已由上面的 `awaitAssistantReply` 从落库投影拿到（那正是"写回提交了"
    // 这一事实本身），这里按它的正文在消息区里定位气泡。
    const resultMessageId = replyMessage.id;
    const replyRow = page.getByTestId("copilot-assistant-message")
      .filter({ hasText: replyMessage.text.slice(0, 40) }).last();
    await expect(replyRow).toBeVisible({ timeout: 60_000 });
    // 回显出自上游进程真实收到的 `content`（见文件头注的取证链路）：本轮触发消息的原文
    // 也在其中，确认这确实是"这一轮"的回复，不是别的固定文案。
    await expect(replyRow).toContainText(CHAT_READ_E2E.agentReplyPrefix);
    await expect(replyRow).toContainText(promptText);
    // 核心断言：`renderAttachmentForModel` 对 `extractionStatus==='failed'` 渲染的那句降级
    // 提示，真的出现在了模型收到、又原样回显出来的内容里——证明抽取管线真被触发、真走到了
    // failed 终态，且这个终态真被读进了这次 run 的组装（不是停在附件表里没人用）。
    await expect(replyRow).toContainText(
      `［附件 ${IMAGE_FILENAME}（image/png）：内容提取失败，无法读取其内容。］`,
    );
    // 反向断言：绝不能出现"抽取成功/已读取内容"的措辞——如果视觉端口被误配置成"可用"，
    // 或本地替身之外意外打到了真实上游并恰好识图成功，这条会如实变红，而不是静默通过。
    await expect(replyRow).not.toContainText("的内容如下");
    await expect(replyRow).not.toContainText("视觉描述");
    await expect(replyRow).not.toContainText("图中文字转录");

    /* ═══════════ ④ 刷新后依旧成立：附件卡片与回复都是重读回来的，不是内存里的一帧 ═══════════ */

    await page.reload();
    await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.imageVisionThreadId}`))
      .toContainText("Image vision extraction fixture thread");
    // issue #2997 —— 附件在 v2 上不在消息气泡里；「这个附件真的落在这条线程上」
    // 改由契约读端口取证（比"界面上画出来了"更接近这条断言的本意：它测的是落库，
    // 不是像素）。气泡内展示那条断言原文保留在文件末尾的 `test.fixme` 里。
    const persistedAttachments = await page.request.get(
      `/chat/threads/${CHAT_READ_E2E.imageVisionThreadId}/attachments`,
      { headers: { Authorization: `Bearer ${bearer}` } },
    );
    expect(persistedAttachments.ok()).toBe(true);
    expect(JSON.stringify(await persistedAttachments.json())).toContain(uploaded.id);
    const persistedMessages = await listPersistedMessages(page, CHAT_READ_E2E.imageVisionThreadId, bearer);
    const persistedTarget = persistedMessages.find((m) => m.id === resultMessageId);
    expect(persistedTarget, "刷新后这条回复应仍在落库投影里").toBeTruthy();
    const persistedReply = page.getByTestId("copilot-assistant-message")
      .filter({ hasText: persistedTarget!.text.slice(0, 40) }).last();
    await expect(persistedReply).toBeVisible({ timeout: 60_000 });
    await expect(persistedReply).toContainText(
      `［附件 ${IMAGE_FILENAME}（image/png）：内容提取失败，无法读取其内容。］`,
    );

    // 独立于回显链路，再用直连 API 复核一次这次 run 确实 succeeded（run 本身没有因为
    // 附件抽取失败而被拖垮——F153 的既有设计：抽取失败只影响这个附件能不能被模型读到，
    // 不影响 run 本身的成败）。
    const headers = await authHeaders(page);
    const runRes = await page.request.get(`/agent-runs/${accepted.agentRunId}`, { headers });
    expect(runRes.ok()).toBe(true);
    const runBody = await runRes.json() as { status: string };
    expect(runBody.status).toBe("succeeded");
  },
);

/**
 * issue #2997 —— **原文保留的断言：消息气泡里的只读附件展示。v2 上没有对等实现。**
 *
 * 上面那条用例原本还断言：发出去之后，消息气泡里有一条只读附件条（文件名 + 大小），
 * 且**不含任何"已提取/视觉描述/图中文字"措辞**——"上传成功 ≠ 内容已读取"这条诚实
 * 纪律的界面证据。v2 的消息气泡完全不渲染附件（`MessageAttachments` 的唯一消费者是
 * 旧屏 `chat-live-message-panel.tsx:1311`），所以这条界面证据现在没有落点。
 *
 * 按人类裁决（方案 B）不删断言、不改宽，用 `test.fixme` 钉住等产品补齐。产品缺口 issue：**#3019**。
 */
test.fixme("F153 附件在消息气泡里只读展示且不谎称已读取内容（v2 尚无对等实现，issue #2997 缺口）", async ({ page }) => {
  await login(page);
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.restructureProjectId}&thread=${CHAT_READ_E2E.imageVisionThreadId}`);

  await page.getByTestId("chat-attachment-input").click();
  await expect(page.getByTestId("chat-attach-material-portal")).toBeVisible();
  const uploadResponsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().endsWith(`/chat/threads/${CHAT_READ_E2E.imageVisionThreadId}/attachments`)
  ));
  await page.getByTestId("chat-attachment-file-input").setInputFiles({
    name: IMAGE_FILENAME, mimeType: "image/png", buffer: Buffer.from(MINIMAL_PNG_BASE64, "base64"),
  });
  const uploaded = await (await uploadResponsePromise).json() as { id: string };
  await page.getByTestId("chat-attach-material-confirm").click();
  await page.getByTestId("copilotkit-v2-input").fill("这张图里写了什么？");
  await page.getByTestId("copilotkit-v2-send").click();

  const sentAttachment = page.getByTestId(`chat-message-attachment-${uploaded.id}`);
  await expect(sentAttachment).toBeVisible();
  await expect(sentAttachment).toContainText(IMAGE_FILENAME);
  await expect(sentAttachment).not.toContainText("已提取");
  await expect(sentAttachment).not.toContainText("视觉描述");
  await expect(sentAttachment).not.toContainText("图中文字");
});
