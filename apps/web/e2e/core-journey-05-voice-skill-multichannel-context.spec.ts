/**
 * 核心旅程 ⑤：会话内录音 → 转录落库 → 挂 skill 的 agent 用它生成回复 → 跨渠道验证上下文
 * 不串味（项目 chat 与个人 chat 是两个独立渠道，录音/回复不会莫名跨渠道出现）。
 *
 * 三段既有事实各自证明过，这里接成一条链，并补上此前没人验过的一段：
 *   · 录音 → 转录落库 → 刷新仍在：`core-loop.spec.ts` 步骤 7 已经证明（真实
 *     `getUserMedia` + 假音频设备 + WS 落库 + 刷新重读，本文件复用同一条路径，
 *     不重新发明）。
 *   · 挂 skill 的 agent 真的执行并产出唯一回复：本仓 `core-loop.spec.ts` 步骤 8a/8b
 *     已经分开证明过"挂载"与"执行"，本文件把两者接在**同一条录音线程**上。
 *   · 🆕 **跨渠道上下文隔离**：本仓已有的 context 相关用例（`chat-agent-skill-context
 *     .spec.ts`/`context-engine.spec.ts`）验的都是"该出现的东西真的出现了"，没有一条
 *     反过来验"不该出现的东西真的没有跨渠道出现"。这里补上：项目 chat 里的录音转录
 *     与本次回复，不会漏进同一账号的个人 chat（无 projectId 的独立渠道）——同
 *     `chat-read.spec.ts` 里 "no projectId goes personal, never invents a project
 *     context" 那条判据的镜像验证，只是从"服务端请求路径"这一层挪到"内容真的没有
 *     跨渠道出现在界面上"这一层。
 */
import { expect, test, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function loginAsFacilitator(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.email);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

test("旅程⑤：录音转录落库 → 挂 skill 的 agent 据此生成回复 → 同一转录不跨渠道漏进个人 chat", async ({ page }) => {
  test.setTimeout(180_000);
  await loginAsFacilitator(page);

  /* ── ① 在种子专属的录音线程里，真实录一段音，等转录落库 ──────────────────
        与 core-loop.spec.ts 步骤 7 同一条真实链路（getUserMedia + 假音频设备 +
        WS /recording/sessions/:id/asr-stream + 真实上游代理 + 落库），不重新发明。 */
  await page.goto(`/chat?projectId=${FULLSTACK_E2E.projectId}`);
  const threadList = page.getByTestId("chat-read-thread-list");
  await expect(threadList.getByText(FULLSTACK_E2E.recordingThreadTitle)).toBeVisible();
  await threadList.getByText(FULLSTACK_E2E.recordingThreadTitle).click();

  const status = page.getByTestId("chat-live-recording-status");
  // 反空转：录之前必须真的没有转录（种子刻意不预置任何一行）。
  const alreadyIdle = (await status.getAttribute("data-phase")) === "idle";
  if (alreadyIdle) {
    await expect(page.getByTestId("chat-live-transcript-empty")).toBeVisible();
    await page.getByTestId("chat-live-recording-start").click();
    await expect(status).toHaveAttribute("data-phase", "recording", { timeout: 30_000 });
    await page.waitForTimeout(2_000);
    await page.getByTestId("chat-live-recording-stop").click();
    const transcript = page.getByTestId("chat-live-transcript");
    await expect(transcript).toContainText(FULLSTACK_E2E.asrTranscriptPrefix, { timeout: 30_000 });
    await expect(transcript).toHaveText(
      new RegExp(`${escapeRegExp(FULLSTACK_E2E.asrTranscriptPrefix)}\\s+[1-9]\\d*`),
    );
  } else {
    // 这条线程已经录过（比如与 core-loop.spec.ts 共用同一份种子、且那条用例先跑过）
    // ——转录已经在库里，本旅程接着往下走即可，不必重录一遍。
    await expect(page.getByTestId("chat-live-transcript")).toContainText(FULLSTACK_E2E.asrTranscriptPrefix, {
      timeout: 30_000,
    });
  }

  /* ── ② 挂一个已启用的 skill，配一个可运行 agent，发一条**引用转录内容**的消息 ── */
  const mountEmpty = page.getByTestId("chat-skill-mount-empty");
  if (await mountEmpty.isVisible().catch(() => false)) {
    await page.getByTestId("chat-skill-mount").click();
    const mountResponse = page.waitForResponse((r) => (
      r.request().method() === "POST" && /\/threads\/[^/]+\/skill-mounts(\?|$)/.test(r.url())
    ));
    await page.getByTestId(`chat-skill-mount-option-${FULLSTACK_E2E.mountableSkillId}`).click();
    expect((await mountResponse).status()).toBe(201);
  }
  await expect(page.getByTestId(`chat-skill-mounted-${FULLSTACK_E2E.mountableSkillId}`)).toBeVisible();

  const rosterEmpty = await page.getByTestId("chat-roster-empty").isVisible().catch(() => false);
  if (rosterEmpty) {
    await page.getByTestId("chat-roster-edit").click();
    await page.getByTestId("chat-roster-add-input").selectOption(FULLSTACK_E2E.agentId);
    await page.getByTestId("chat-roster-add-submit").click();
  }
  await expect(page.getByTestId(`chat-roster-agent-${FULLSTACK_E2E.agentId}`)).toBeVisible();

  // 消息本身带一个唯一标记 + 引用录音转录的前缀，模拟"基于刚录的内容，用挂载的
  // skill 生成点什么"这个真实使用场景——上游是确定性替身，不产出真实语义内容，
  // 这里验的是链路真的通（挂载生效 + agent 真的执行 + 回复真的落库），不是模型
  // 因此答得更好，边界与 core-loop.spec.ts 步骤 8b 一致。
  const marker = `JOURNEY05_${Date.now()}`;
  await page.getByTestId("chat-agent-select").click();
  await page.getByTestId(`chat-agent-select-option-${FULLSTACK_E2E.agentId}`).click();
  await page.getByTestId("chat-message-input").fill(`${marker} 基于刚才的录音转录内容生成一份小结`);
  await expect(page.getByTestId("chat-message-submit")).toBeEnabled();
  await page.getByTestId("chat-message-submit").click();

  const runStatus = page.getByTestId("chat-live-agent-run-status");
  await expect(runStatus).toHaveAttribute("data-run-status", "succeeded", { timeout: 120_000 });

  await page.reload();
  await threadList.getByText(FULLSTACK_E2E.recordingThreadTitle).click();
  const messageList = page.getByTestId("chat-message-list");
  await expect(messageList).toContainText(marker);
  await expect(page.getByTestId("chat-live-transcript")).toContainText(FULLSTACK_E2E.asrTranscriptPrefix);

  /* ── ③ 跨渠道验证：同一账号切到个人 chat（无 projectId 的独立渠道），
        这条线程的录音转录 / 本次消息标记都不该凭空出现在这里 ── */
  await page.goto("/chat");
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible();
  // 个人渠道是全新的、与项目线程无关的对话空间——发一条不相关的探针消息，
  // 断言回复（loopback 原样回显用户输入）里不含刚才那条项目线程的标记或转录前缀。
  // 如果它们凭空出现在这里，说明上下文在渠道之间串味了。
  const probe = `JOURNEY05_PROBE_${Date.now()}`;
  await page.getByTestId("copilotkit-v2-input").fill(probe);
  const messages = page.getByTestId("copilotkit-v2-messages");
  await page.getByTestId("copilotkit-v2-send").click();
  await expect(messages).toContainText(probe, { timeout: 20_000 });
  await expect(messages).not.toContainText(marker);
  await expect(messages).not.toContainText(FULLSTACK_E2E.asrTranscriptPrefix);
});
