import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { login } from "./chat-task-workbench-fixture";
import { createThreadViaApi } from "./support/authoritative-thread";
import { expectAssistantTurnSettled } from "./support/chat-path-coverage";
import { selectWorkbenchAgent } from "./support/workbench-run-evidence";

/**
 * Product screenshots of the current /chat v2 workbench, using the authenticated
 * chat-read stack and its deterministic upstreams. This is evidence collection,
 * invoked by shots:chat-main, rather than a fidelity scoring gate.
 *
 * #4605: the legacy thread list, agent selector, streaming row, tool chain and
 * microphone controls no longer describe this route. Follow actual v2 controls
 * throughout each journey; retain filenames used by existing evidence reviews.
 * Project, personal and responsive journeys have independent browser contexts.
 */
const OUT = resolve(process.env.CHAT_SHOTS_OUT ?? ".chat-shots");
const DESKTOP = { width: 1440, height: 900 };
const TABLET = { width: 768, height: 1024 };
const MOBILE = { width: 375, height: 812 };
// Outside Playwright's scratch outputDir: subsequent e2e runs must not erase evidence.
test.setTimeout(300_000);
test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

async function shoot(page: Page, file: string, testId: string): Promise<void> {
  await expect(page.getByTestId(testId).first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${OUT}/${file}` });
}

async function enter(page: Page, url = "/chat"): Promise<void> {
  await page.setViewportSize(DESKTOP);
  await login(page);
  await page.goto(url);
  await expect(page.getByTestId("chat-task-workbench-composer")).toBeVisible();
  await expect(page.getByTestId("copilotkit-v2-input")).toBeEnabled();
}

async function send(page: Page, text: string): Promise<void> {
  await page.getByTestId("copilotkit-v2-input").fill(text);
  await page.getByTestId("copilotkit-v2-send").click();
}

async function toolTurn(page: Page): Promise<void> {
  await selectWorkbenchAgent(page, CHAT_READ_E2E.deepAgentId);
  await send(page, "请帮我查一下现在几点");
  await expectAssistantTurnSettled(page, 90_000);
  const toggle = page.getByTestId("run-trace-toggle").last();
  await expect(toggle).toBeVisible();
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  await expect(page.getByTestId("run-trace-body").last()).toBeVisible();
  await expect(page.getByTestId("run-trace-entry").filter({ has: page.getByTestId("copilotkit-v2-tool-generic") }).first()).toBeVisible();
}

test("capture chat main screen — project conversation", async ({ page }) => {
  await enter(page, `/chat?projectId=${CHAT_READ_E2E.projectId}&thread=${CHAT_READ_E2E.threadId}`);
  await shoot(page, "chat-main-default.png", "copilotkit-v2-thread-list");
  await selectWorkbenchAgent(page, CHAT_READ_E2E.deepAgentId);
  // The slow deterministic script gives the real running UI time to be photographed.
  await send(page, CHAT_READ_E2E.deepAgentSlowTrigger);
  await expect(page.getByTestId("copilotkit-v2-send")).toHaveAttribute("data-send-state", "running");
  await shoot(page, "chat-main-project-in-progress.png", "chat-task-workbench-composer");
  await expectAssistantTurnSettled(page, 90_000);
  await toolTurn(page);
  await shoot(page, "chat-main-project-tool-call.png", "run-trace-body");

  const landOpen = page.locator('[data-testid^="chat-land-artifact-open-"]').last();
  await expect(landOpen).toBeVisible();
  const messageId = (await landOpen.getAttribute("data-testid"))!.slice("chat-land-artifact-open-".length);
  await landOpen.click();
  await page.getByTestId(`chat-land-artifact-submit-${messageId}`).click();
  await expect(page.getByTestId(`chat-land-artifact-done-${messageId}`)).toBeVisible();
  await page.getByTestId(`chat-land-artifact-expand-${messageId}`).click();
  await shoot(page, "chat-main-project-artifact-card.png", `chat-land-artifact-content-${messageId}`);

  // The current Inspector uses tabs. Capture real uploaded material in that tab,
  // rather than waiting for the retired stacked artifacts/materials sidebar.
  await page.getByTestId("chat-attachment-input").click();
  await expect(page.getByTestId("chat-attach-material-portal")).toBeVisible();
  await page.getByTestId("chat-attachment-file-input").setInputFiles({
    name: "project-shot-material.txt", mimeType: "text/plain",
    buffer: Buffer.from("项目对话截图取证素材。"),
  });
  await expect(page.locator('[data-testid^="chat-attach-material-att-chip-"]')).toHaveAttribute("data-status", "uploaded");
  await page.getByTestId("chat-attach-material-confirm").click();
  await send(page, "这条消息带着刚上传的材料");
  await expectAssistantTurnSettled(page, 90_000);
  await page.getByTestId("chat-task-workbench-inspector-tab-materials").click();
  await expect(page.locator('[data-testid^="chat-material-"]').first()).toBeVisible();
  await shoot(page, "chat-main-project-right-panel.png", "chat-materials-panel");

  await page.getByTestId("chat-skill-mount").click();
  await page.getByTestId(`chat-skill-mount-option-${CHAT_READ_E2E.mountableSkillId}`).click();
  await expect(page.getByTestId(`chat-skill-mounted-${CHAT_READ_E2E.mountableSkillId}`)).toBeVisible();
  await send(page, "这条消息发出时挂着技能");
  await expectAssistantTurnSettled(page, 90_000);
  await shoot(page, "chat-main-project-skill-chip.png", `chat-skill-mounted-${CHAT_READ_E2E.mountableSkillId}`);
});

test("capture chat main screen — personal conversation", async ({ page }) => {
  await enter(page);
  await shoot(page, "chat-main-personal.png", "copilotkit-v2-thread-list");
  await page.getByTestId("chat-thread-create").click();
  await page.waitForURL(/\/chat\?thread=/);
  await expect(page.getByTestId("copilotkit-v2-empty")).toBeVisible();
  await shoot(page, "chat-main-personal-created.png", "chat-task-workbench-composer");

  await selectWorkbenchAgent(page, CHAT_READ_E2E.agentId);
  const prompt = "对话保真取证：请回显这句话";
  await send(page, prompt);
  const fullReply = `${CHAT_READ_E2E.agentReplyPrefix} ${prompt}`;
  const reply = page.getByTestId("chat-ai-markdown").last();
  // Require an actual partial answer while the run is active, not an empty or final frame.
  await expect.poll(async () => {
    const text = (await reply.textContent().catch(() => ""))?.trim() ?? "";
    return text.length > 0 && text.length < fullReply.length
      && await page.getByTestId("copilotkit-v2-send").getAttribute("data-send-state") === "running";
  }, { timeout: 30_000, intervals: [50] }).toBe(true);
  await shoot(page, "chat-main-personal-streaming.png", "chat-ai-markdown");
  await expectAssistantTurnSettled(page, 90_000);
  await expect(reply).toContainText(fullReply);
  await shoot(page, "chat-main-personal-reply.png", "chat-ai-markdown");
  await toolTurn(page);
  await shoot(page, "chat-main-personal-tool-call.png", "run-trace-body");

  const mic = page.getByTestId("chat-task-workbench-composer-mic");
  await mic.click();
  await expect(mic).toHaveAttribute("data-voice-phase", "listening", { timeout: 15_000 });
  await shoot(page, "chat-main-personal-mic-listening.png", "chat-task-workbench-composer-recording-timer");
  await expect(page.getByTestId("chat-task-workbench-composer-live-transcript")).toContainText(CHAT_READ_E2E.asrTranscriptPrefix, { timeout: 15_000 });
  await shoot(page, "chat-main-personal-mic-partial.png", "chat-task-workbench-composer-live-transcript");
  await mic.click();
  await expect(mic).toHaveAttribute("data-voice-phase", "idle", { timeout: 15_000 });
  await expect(page.getByTestId("copilotkit-v2-input")).toHaveValue(new RegExp(CHAT_READ_E2E.asrTranscriptPrefix));
  await shoot(page, "chat-main-personal-mic-transcribed.png", "chat-task-workbench-composer");

  await send(page, CHAT_READ_E2E.deepAgentFailureTrigger);
  await expect(page.getByTestId("copilotkit-v2-error")).toBeVisible({ timeout: 60_000 });
  await shoot(page, "chat-main-personal-failure.png", "copilotkit-v2-error");
});

test("capture chat main screen — responsive", async ({ page }) => {
  await enter(page, `/chat?projectId=${CHAT_READ_E2E.projectId}&thread=${CHAT_READ_E2E.threadId}`);
  await page.setViewportSize(MOBILE);
  await shoot(page, "chat-main-mobile.png", "chat-task-workbench-composer");
  await page.setViewportSize(TABLET);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await shoot(page, "chat-main-project-tablet.png", "copilotkit-v2-thread-list");

  await page.setViewportSize(DESKTOP);
  await page.goto("/chat");
  const threadId = await createThreadViaApi(page);
  await page.goto(`/chat?thread=${threadId}`);
  await page.setViewportSize(MOBILE);
  await shoot(page, "chat-main-personal-mobile-detail.png", "chat-task-workbench-composer");
  const toggle = page.getByTestId("copilotkit-v2-mobile-list-toggle");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await shoot(page, "chat-main-personal-mobile-list.png", "copilotkit-v2-thread-list");
});
