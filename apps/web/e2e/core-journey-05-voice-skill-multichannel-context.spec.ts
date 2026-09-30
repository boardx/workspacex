import { openWorkbenchRoster } from "./support/workbench-journey";
import { selectWorkbenchAgent, submitWorkbenchRun } from "./support/workbench-run-evidence";
/**
 * 核心旅程 ⑤：转写内录音 → 转录落库并挂入项目 → 挂 skill 的 agent 在项目线程里生成回复 →
 * 跨渠道验证上下文不串味（项目 chat 与个人 chat 是两个独立渠道，项目线程里的消息标记
 * 与录音转录都不会莫名跨渠道出现在个人 chat）。
 *
 * ⚠ #4744 之后本旅程的链条**变了**，如实记录：「会话录音」面板已从项目对话里删除，录音
 * 归口到「转写」（`/rec`）。转写的转录是**项目资源**（`personal_transcription`，挂入项目），
 * **不再绑在某条 chat 线程上**——所以旧版「agent 据录音转录内容生成小结」这一环在产品上
 * 已不存在：项目对话里没有任何代码把这条转录喂给 agent。本文件**不假装**它还存在：
 * ② 里的消息只带唯一标记，不再声称引用转录；转录与 agent 回复之间**没有**被断言的关联。
 *
 * 三段既有事实各自证明过，这里接成一条链：
 *   · 录音 → 转录落库 → 刷新仍在：与 `core-loop.spec.ts` 步骤 7 同一条真实路径
 *     （转写页 + 真实 `getUserMedia` + 假音频设备 + personal realtime ASR WS + 落库），
 *     本文件复用，不重新发明；这里只多断言一句刷新后仍在，以及挂入项目的请求 2xx。
 *   · 挂 skill 的 agent 真的执行并产出唯一回复：`core-loop.spec.ts` 步骤 8a/8b 已经分开
 *     证明过"挂载"与"执行"，本文件把两者接在**同一条项目线程**上。
 *   · 🆕 **跨渠道上下文隔离**：本仓已有的 context 相关用例验的都是"该出现的东西真的出现了"，
 *     没有一条反过来验"不该出现的东西真的没有跨渠道出现"。这里补上：项目线程里的消息标记
 *     与录音转录，不会漏进同一账号的个人 chat（无 projectId 的独立渠道）——同
 *     `chat-read.spec.ts` 里 "no projectId goes personal, never invents a project
 *     context" 那条判据的镜像验证，只是从"服务端请求路径"这一层挪到"内容真的没有
 *     跨渠道出现在界面上"这一层。
 */
import { expect, test, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";
import { clickActionableSkillMountOption } from "./support/skill-mount";

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function loginAsFacilitator(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.email);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/);
}

test("旅程⑤：转写内录音落库并挂入项目 → 项目线程里挂 skill 的 agent 生成回复 → 转录与标记不跨渠道漏进个人 chat", async ({ page }) => {
  test.setTimeout(180_000);
  await loginAsFacilitator(page);

  /* ── ① 在转写页里真实录一段音，转录落库并挂入本项目，刷新仍在 ─────────────
        与 core-loop.spec.ts 步骤 7 同一条真实链路（getUserMedia + 假音频设备 +
        WS personal realtime ASR + 真实上游代理 + appendFinal 落库），不重新发明。
        每次都新建一条转录（名字唯一），所以不再有「已经录过」的分支。 */
  await page.goto(`/rec?projectId=${FULLSTACK_E2E.projectId}`);
  await expect(page.getByTestId("rec-history-page")).toBeVisible();
  const recName = `旅程五录音 ${Date.now()}`;
  await page.getByTestId("rec-create-open").click();
  await page.getByTestId("rec-create-name").fill(recName);
  const createResponse = page.waitForResponse((r) => (
    r.request().method() === "POST" && /\/recording\/realtime-asr\/sessions(\?|$)/.test(r.url())
  ));
  const linkResponse = page.waitForResponse((r) => (
    r.request().method() === "POST"
    && new RegExp(`/projects/${escapeRegExp(encodeURIComponent(FULLSTACK_E2E.projectId))}/resources(\\?|$)`).test(r.url())
  ));
  await page.getByTestId("rec-create-submit").click();
  const created = await createResponse;
  expect(created.ok()).toBe(true);
  const recSessionId = ((await created.json()) as { sessionId: string }).sessionId;
  expect((await linkResponse).ok(), "新建后必须挂入项目").toBe(true);

  const toggle = page.getByTestId("rec-live-toggle");
  // 反空转：录之前必须真的没有转录。
  await expect(toggle).toHaveText("开始转录");
  await expect(page.getByTestId("rec-live-content")).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveText("停止转录", { timeout: 30_000 });
  await page.waitForTimeout(2_000);
  await toggle.click();
  await expect(toggle).toHaveText(/^(继续转录|开始转录)$/, { timeout: 30_000 });
  const transcript = page.getByTestId("rec-live-content");
  await expect(transcript).toContainText(FULLSTACK_E2E.asrTranscriptPrefix, { timeout: 30_000 });
  await expect(transcript).toHaveText(
    new RegExp(`${escapeRegExp(FULLSTACK_E2E.asrTranscriptPrefix)}\\s+[1-9]\\d*`),
  );
  // 刷新后仍在（写进库，不是写进 React state）。
  await page.reload();
  await page.getByTestId(`rec-history-open-${recSessionId}`).click();
  await expect(page.getByTestId("rec-live-content")).toContainText(FULLSTACK_E2E.asrTranscriptPrefix, {
    timeout: 30_000,
  });

  /* ── 切到项目对话里种子预置的线程（转录不在线程里，这一步只是去挂 skill 的地方） ── */
  await page.goto(`/chat?projectId=${FULLSTACK_E2E.projectId}`);
  const threadList = page.getByTestId("copilotkit-v2-thread-list");
  await expect(threadList.getByText(FULLSTACK_E2E.recordingThreadTitle)).toBeVisible();
  await threadList.getByText(FULLSTACK_E2E.recordingThreadTitle).click();

  /* ── ② 挂一个已启用的 skill，配一个可运行 agent，发一条带唯一标记的消息 ── */
  await expect(page.getByTestId("chat-skill-mount")).toBeEnabled();
  const mountPanel = page.getByTestId("chat-skill-mount-panel");
  await expect(mountPanel).toBeAttached();
  if (await mountPanel.getAttribute("data-mounted-count") === "0") {
    await page.getByTestId("chat-skill-mount").click();
    const mountResponse = page.waitForResponse((r) => (
      r.request().method() === "POST" && /\/threads\/[^/]+\/skill-mounts(\?|$)/.test(r.url())
    ));
    await clickActionableSkillMountOption(page, FULLSTACK_E2E.mountableSkillId);
    expect((await mountResponse).status()).toBe(201);
  }
  await expect(page.getByTestId(`chat-skill-mounted-${FULLSTACK_E2E.mountableSkillId}`)).toBeVisible();

  await openWorkbenchRoster(page);
  const rosterEmpty = await page.getByTestId("chat-roster-empty").isVisible().catch(() => false);
  if (rosterEmpty) {
    await page.getByTestId("chat-roster-edit").click();
    await page.getByTestId("chat-roster-add-input").selectOption(FULLSTACK_E2E.agentId);
    await page.getByTestId("chat-roster-add-submit").click();
  }
  await expect(page.getByTestId(`chat-roster-agent-${FULLSTACK_E2E.agentId}`)).toBeVisible();

  // 消息只带一个唯一标记。#4744 之后转录是项目资源、不在线程里，项目对话也不会把它喂给
  // agent，所以这里**不再**声称"基于录音转录生成小结"——上游是确定性替身，不产出真实语义
  // 内容，这里验的是链路真的通（挂载生效 + agent 真的执行 + 回复真的落库），边界与
  // core-loop.spec.ts 步骤 8b 一致。
  const marker = `JOURNEY05_${Date.now()}`;
  await selectWorkbenchAgent(page, FULLSTACK_E2E.agentId);
  await page.getByTestId("copilotkit-v2-input").fill(`${marker} 请生成一份小结`);
  await expect(page.getByTestId("copilotkit-v2-send")).toBeEnabled();
  await submitWorkbenchRun(page);

  const messageList = page.getByTestId("copilotkit-v2-messages");
  await expect(messageList).toContainText(marker);

  /* ── ③ 跨渠道验证：同一账号切到个人 chat（无 projectId 的独立渠道），
        项目的录音转录 / 项目线程里的消息标记都不该凭空出现在这里 ── */
  await page.goto("/chat");
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible();
  // 个人渠道是全新的、与项目线程无关的对话空间——发一条不相关的探针消息，
  // 断言回复（loopback 原样回显用户输入）里不含刚才那条项目线程的标记或转录前缀。
  // 如果它们凭空出现在这里，说明上下文在渠道之间串味了。
  const probe = `JOURNEY05_PROBE_${Date.now()}`;
  await page.getByTestId("copilotkit-v2-input").fill(probe);
  const messages = page.getByTestId("copilotkit-v2-messages");
  await selectWorkbenchAgent(page, FULLSTACK_E2E.agentId);
  await submitWorkbenchRun(page);
  await expect(messages).toContainText(probe, { timeout: 20_000 });
  await expect(messages).not.toContainText(marker);
  await expect(messages).not.toContainText(FULLSTACK_E2E.asrTranscriptPrefix);
});
