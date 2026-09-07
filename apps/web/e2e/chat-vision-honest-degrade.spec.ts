import { createNamedWorkbenchThread, openWorkbenchRoster } from "./support/workbench-journey";
import { selectWorkbenchAgent, submitWorkbenchRun } from "./support/workbench-run-evidence";
/**
 * P2（#1561）—— 真实浏览器：上传图片 → 发消息触发 run → 图像通道是否真的被组装进
 * `ModelCallInput`，以及当前部署没有视觉能力时是否真的走了**诚实降级**（而不是静默
 * 丢图，也不是假装看到了）。
 *
 * ## 为什么原 PR（#1565）没有这条测试是个真实缺口
 *
 * `run-image-input.ts` / `execute-run.ts` 的单测能证明「函数纯逻辑对」，但证不了
 * 「真实浏览器上传的字节真的顺着 `chat_message_attachments` → `RunImageInput.list/read`
 * → `gatherVisionImages` → `userText` 这条链走到了模型输入」——那条链只有真栈 e2e 能测。
 *
 * ## 本机没有 KERNEL_MODEL_API_KEY，测不了"模型真的识图"——这条测的是诚实降级路径
 *
 * `playwright.fullstack-smoke.config.ts` 下发的确定性上游是 `fullstack-loopback` /
 * `loopback-echo`（`FULLSTACK_E2E.agentModelProvider/agentModelId`）。
 * `KERNEL_MODEL_VISION_IDS` 在这套 webServer 环境里**没有被设置**，
 * `readVisionModelIds()` 的默认值是 `qwen-vl-max,qwen-vl-plus`
 * （`configured-model-provider.ts:107`）——`loopback-echo` 不在其中，所以
 * `ConfiguredModelProvider.supportsVision()` 对这次 run 恒回 `false`。这不是本测试
 * 硬编码出来的假设，是这套 e2e 环境本来就没有任何"看得见图"的 provider，天然落在
 * `execute-run.ts` 的 fail-closed 分支（`supportsVision?.(...) ?? false`）。
 *
 * ## 能验到的最深一层，以及验不到的部分——如实写在这里
 *
 *   · **能验到**：图片字节真的从浏览器上传、落进 `chat_message_attachments`、被
 *     `gatherVisionImages` 取出、判定为"这次运行绑定的模型不具备视觉输入能力"、把
 *     `renderVisionNotice()` 产出的**诚实告知文案**拼进 `userText`、`userText` 真的被
 *     发给了模型（确定性上游 `loopback-model-provider.ts` 回显它收到的 `user` 字段）、
 *     写回库、刷新后仍在——这是一条完整的"图像通道被组装进 ModelCallInput"的端到端证据链。
 *   · **验不到**：真实模型识图（"看到图里有什么"）。那需要一个真的支持视觉的 provider
 *     与真实上游 key，本机没有，`AGENTS.md` 也不许伪造响应/静默 mock fallback 去冒充它。
 *     `images` 字段本身（`ModelCallInput.images`）在这条路径上恒为空数组（因为
 *     `supportsVision` 为 false，`execute-run.ts:924` 的门直接不填它）——本测试因此
 *     **不断言** `images` 数组非空，那句断言在这套环境下会永远是假的、且假的方式与
 *     "图像通道没接好"完全区分不开，写出来只会是一句自证空转的断言。
 *
 * 诚实告知的文案逐字来自 `apps/api/src/application/agent-run/run-image-input.ts` 的
 * `renderVisionNotice()`：
 *
 *   ［本轮消息附带 N 张图片，但本次运行绑定的模型（<provider> / <modelId>）不具备视觉
 *   输入能力——你看不到这些图的内容。不要凭文件名猜测或假装看过；用户问起图里有什么时，
 *   如实说明你这一轮没有收到图像内容。］
 *
 * 断言按这个真实形状拼，不是编一句大概像的话。
 */
import { expect, test, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

/**
 * 1x1 透明 PNG（合法字节，不是随手拼的字符串）——`isModelCallImageMime`/
 * `ATTACHMENT_MIME_ALLOWLIST` 按 `image/png` 判定，服务端不信任客户端声明的
 * mime，会从字节核验，所以这里必须是真的 PNG 字节，不能是伪装扩展名的文本。
 */
const ONE_PIXEL_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("P2/#1561：上传图片发消息，视觉能力缺席时模型收到诚实告知而非被静默丢图", async ({ page }) => {
  test.setTimeout(180_000);
  await loginAs(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);
  await page.goto(`/chat?projectId=${FULLSTACK_E2E.projectId}`);

  // ── 本用例专属线程 ─────────────────────────────────────────────────────
  const title = `P2 图像诚实降级 ${Date.now()}`;
  const threadList = page.getByTestId("copilotkit-v2-thread-list");
  await createNamedWorkbenchThread(page, title, FULLSTACK_E2E.projectId);

  // ── 把可运行的那个 agent 挂进本线程编制（同 core-loop 步骤 8b 同一条真实路径） ──
  await openWorkbenchRoster(page);
    await page.getByTestId("chat-roster-edit").click();
  await page.getByTestId("chat-roster-add-input").selectOption(FULLSTACK_E2E.agentId);
  await page.getByTestId("chat-roster-add-submit").click();
  await expect(page.getByTestId(`chat-roster-agent-${FULLSTACK_E2E.agentId}`)).toBeVisible();
  await selectWorkbenchAgent(page, FULLSTACK_E2E.agentId);

  // ── 真实浏览器上传一张图片附件到这条线程 ──────────────────────────────
  // 隐藏 input 由 `ChatAttachmentButton` 无条件渲染（不挂在「加材料」弹窗打开与否上），
  // 直接对它 `setInputFiles` 就是走真实的 `pickFiles → doUpload` 上传路径，不是绕过它。
  await expect(page.getByTestId("chat-attachment-list")).toHaveCount(0);
  await page.getByTestId("chat-attachment-file-input").setInputFiles({
    name: "vision-honesty-check.png",
    mimeType: "image/png",
    buffer: Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"),
  });

  // 等上传真的完成（不是只等它出现在待发列表里）——`data-status="uploaded"` 直接来自
  // `useChatAttachments` 的真实上传状态机，不是一个乐观的占位态。
  const chip = page.getByTestId(/^chat-attachment-chip-/);
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute("data-status", "uploaded", { timeout: 30_000 });
  await expect(page.getByTestId("chat-attachment-error")).toHaveCount(0);

  // ── 发一条带唯一标记的消息，触发本轮 run ──────────────────────────────
  const marker = `P2_VISION_HONESTY_${Date.now()}`;
  await page.getByTestId("copilotkit-v2-input").fill(marker);
  await expect(page.getByTestId("copilotkit-v2-send")).toBeEnabled();

  await submitWorkbenchRun(page);

  // ── 回复正文：确定性上游回显了它真实收到的 userText ───────────────────
  // 这条断言链是本测试的核心证据：回复里同时出现「用户标记」与「诚实告知文案」，
  // 证明的是 `execute-run.ts` 真的把 `renderVisionNotice()` 的输出拼进了发给模型的
  // `userText`，而不是图片被悄悄丢在半路、模型收到的只是一条干净的纯文本消息。
  const messageList = page.getByTestId("copilotkit-v2-messages");
  await expect(messageList).toContainText(marker);
  const replyRow = messageList.getByTestId("copilot-assistant-message");
  await expect(replyRow).toHaveCount(1);

  // 文案逐字对齐 `run-image-input.ts` 的 `renderVisionNotice()`（见本文件头注），
  // 不是拍脑袋写的近似句子——改了那边的措辞，这里必须跟着红,不能悄悄继续绿。
  const expectedDegradationReason = `本次运行绑定的模型（${FULLSTACK_E2E.agentModelProvider} / ${FULLSTACK_E2E.agentModelId}）不具备视觉输入能力`;
  const expectedNotice = `［本轮消息附带 1 张图片，但${expectedDegradationReason}——`
    + "你看不到这些图的内容。不要凭文件名猜测或假装看过；用户问起图里有什么时，"
    + "如实说明你这一轮没有收到图像内容。］";
  await expect(replyRow).toContainText(expectedNotice);

  // ── 刷新后仍在：诚实告知文案是写进库、随写回落地的一部分，不是内存里的一帧 ──
  await page.reload();
  await threadList.getByText(title).click();
  const persistedReplyRow = page.getByTestId("copilotkit-v2-messages");
  await expect(persistedReplyRow).toContainText(expectedNotice);
});
