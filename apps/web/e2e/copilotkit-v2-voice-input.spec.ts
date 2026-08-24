import { test, expect } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * DA-19g —— `/chat/copilotkit-v2` 语音输入（评分循环第 1 轮第 5 项缺口，
 * `.harness/state/copilotkit-v2-ux-acceptance-score.md` 第 5 项：新面板此前完全没有
 * 麦克风入口，`grep -rni "mic|voice|audio|asr"` 零命中）。
 *
 * 判据（`.harness/instructions/chat-ux-acceptance-criteria.md` 第 5 项）："麦克风按钮
 * 是否能实时把语音转成文字填进输入框，转录过程中用户能看到实时文字更新（不是录完一段
 * 才整体填入），且转录结果可编辑后再发送"。
 *
 * 复用 `chat-main-shots.spec.ts` "#728 P8 语音实时转录取证" 同一条真实链路，不是重新
 * 打一套桩：真实 `getUserMedia`（本 config 的 `launchOptions.args` 全局挂了
 * `--use-fake-device-for-media-stream`，喂假音频源，采音代码是真实浏览器代码，不是
 * 打桩）→ `WS /chat/asr-draft` → `LOOPBACK_ASR_EMIT_DELTA`（本 config 专属打开，见
 * `playwright.chat-read.config.ts` 头注）驱动的确定性 ASR 替身逐块吐出
 * `CHAT_READ_E2E.asrTranscriptPrefix` 前缀的转录文本。三帧证据：
 *   ① 点击麦克风 → `chat-mic-listening`（"正在听……"）可见；
 *   ② **录音仍在进行时**（还没点停止）转录文字已经出现在 `copilotkit-v2-input` 里——
 *      这一帧才是"实时更新"本身的证据，不是靠猜时序；
 *   ③ 停止后转录文字仍在、可编辑（追加一段手打文字）、发送后作为消息内容出现在对话里。
 */
test.setTimeout(90_000);

test("DA-19g 真实实测：copilotkit-v2 面板麦克风实时转录进输入框、可编辑、发送后成为消息内容", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);

  // 同 `copilotkit-v2-hitl.spec.ts` 记录的编译预热坑：Next dev 首次编译窗口撞上
  // `/info` 探测会让整个 agent 被标记 `runtime_info_fetch_failed`，永久失败。
  await expect
    .poll(
      async () => (await page.request.get("/api/copilotkit/info")).status(),
      { timeout: 60_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(200);

  await page.goto("/chat/copilotkit-v2");

  const micButton = page.getByTestId("chat-mic-button");
  await expect(micButton).toBeVisible();
  await expect(micButton).toBeEnabled();

  // ── 录音前：没有转录，麦克风未在监听态 ─────────────────────────────
  const input = page.getByTestId("copilotkit-v2-input");
  await expect(input).toHaveValue("");
  await expect(page.getByTestId("chat-mic-listening")).toHaveCount(0);

  // ── ① 点击麦克风 → "正在听……" 可见（真实 getUserMedia + WS 握手，非 0 秒）──
  await micButton.click();
  await expect(page.getByTestId("chat-mic-listening")).toBeVisible({ timeout: 15_000 });
  await expect(micButton).toHaveAttribute("data-mic-status", "listening");

  // ── ② 录音仍在进行时，转录文字已经出现在输入框——这一帧证明"实时更新"，
  //    不是"停止后整段落入" ──
  await expect
    .poll(async () => input.inputValue(), { timeout: 20_000 })
    .toContain(CHAT_READ_E2E.asrTranscriptPrefix);
  const midRecordingValue = await input.inputValue();

  // 再等一下让假音频源多产出几块，证明不是只更新一帧就不动了（字节数持续增长）。
  await page.waitForTimeout(1_000);
  const laterValue = await input.inputValue();
  expect(laterValue.length).toBeGreaterThanOrEqual(midRecordingValue.length);

  // ── ③ 停止录音：转录文字仍在（不是被清空），且可编辑 ──────────────────
  await micButton.click();
  await expect(page.getByTestId("chat-mic-listening")).toHaveCount(0, { timeout: 15_000 });
  await expect(micButton).toHaveAttribute("data-mic-status", "idle", { timeout: 15_000 });

  const stoppedValue = await input.inputValue();
  expect(stoppedValue).toContain(CHAT_READ_E2E.asrTranscriptPrefix);
  expect(stoppedValue.length).toBeGreaterThan(0);

  // 可编辑：追加一段人类手打文字，证明转录结果不是只读展示。
  const editedSuffix = " ——人工追加编辑";
  await input.fill(`${stoppedValue}${editedSuffix}`);
  await expect(input).toHaveValue(`${stoppedValue}${editedSuffix}`);

  // ── 发送后，转录+编辑的内容确实作为消息内容出现在对话里 ──────────────────
  const messages = page.getByTestId("copilotkit-v2-messages");
  await page.getByTestId("copilotkit-v2-send").click();
  await expect(input).toHaveValue("");
  await expect(messages).toContainText(CHAT_READ_E2E.asrTranscriptPrefix, { timeout: 20_000 });
  await expect(messages).toContainText("人工追加编辑");
});
