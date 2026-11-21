import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";
import { bearerOf } from "./chat-v2-send";

test.use({
  permissions: ["microphone"],
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
});
for (const width of [1280, 390]) {
  test(`recording controls scroll at ${width}px and retain playable audio`, async ({ page }) => {
    await page.setViewportSize({ width, height: 660 });
    await page.goto("/login");
    await page.getByTestId("login-email").fill(FULLSTACK_E2E.leadEmail);
    await page.getByTestId("login-password").fill(FULLSTACK_E2E.leadPassword);
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/home$/);
    await page.goto("/aidt");
    await page.getByTestId("aidt-new").click();
    await page.getByTestId("project-new-name").fill("录音滚动验收 " + randomUUID().slice(0, 8));
    await page.getByTestId("project-new-create").click();
    await expect(page).toHaveURL(/\/aidt\/[^/?]+$/);
    const pathname = new URL(page.url()).pathname;
    const id = randomUUID();
    const questions = Array.from({ length: 16 }, (_, i) => `问题 ${i + 1}：请描述一次实际经历。`).join("\n");
    const response = await page.request.put("/__fullstack_api/projects/" + pathname.split("/").pop() + "/aidt/stages/2", {
      headers: { Authorization: "Bearer " + await bearerOf(page) },
      data: { operationId: randomUUID(), expectedRevision: 0, sourceStageRevisions: [], content: { schemaVersion: 1,
        draft: { ideas: [], selectedIdeaId: "", fields: { ["interviewRecord:" + id]: JSON.stringify({
          version: 1, id, code: "U01", topicRevision: null, topic: "", goal: "", original: "初稿", adopted: questions,
          guideConfirmed: true, consent: { observedAt: new Date().toISOString(), notes: true, audio: true, capture: true, asr: false, photos: false },
        }) } } } },
    });
    expect(response.ok()).toBe(true);
    await page.goto(pathname + "?step=2&entity=" + id);
    await expect.poll(() => new URL(page.url()).searchParams.get("thread")).toMatch(/^thr_aidt_/);
    const timeline = page.getByTestId("copilotkit-v2-messages");
    const controls = timeline.getByTestId("aidt-interview-chat-actions");
    await expect(controls).toBeVisible();
    await expect(page.getByTestId("copilotkit-v2-input")).toBeInViewport();
    await timeline.focus();
    await page.keyboard.press("End");
    await expect.poll(() => timeline.evaluate(el => el.scrollTop)).toBeGreaterThan(50);
    await page.keyboard.press("Home");
    await expect.poll(() => timeline.evaluate(el => el.scrollTop)).toBe(0);
    const mobile = page.getByTestId("chat-task-workbench-mobile-open");
    if (await mobile.isVisible() && !await page.getByRole("dialog").isVisible()) await mobile.click();
    const materials = page.getByTestId("chat-task-workbench-inspector-tab-materials");
    if (!await materials.isVisible()) await page.getByTestId("chat-task-workbench-inspector-expand").click();
    await materials.click();
    const pane = page.getByRole("tabpanel");
    await expect(pane.getByRole("heading", { name: "授权和材料" })).toBeVisible();
    const recorder = pane.getByRole("region", { name: "当前受访者录音" });
    await recorder.getByRole("button", { name: "开始录音" }).click();
    await expect(recorder.getByRole("status").filter({ hasText: "正在录音" })).toBeVisible();
    await expect(recorder.getByRole("timer")).not.toHaveText("00:00");
    await pane.focus();
    await page.keyboard.press("Home");
    await expect.poll(() => pane.evaluate(el => el.scrollTop)).toBe(0);
    await pane.hover();
    await page.mouse.wheel(0, 600);
    await expect.poll(() => pane.evaluate(el => el.scrollTop)).toBeGreaterThan(50);
    await page.mouse.wheel(0, -1000);
    await expect.poll(() => pane.evaluate(el => el.scrollTop)).toBe(0);
    await recorder.getByRole("button", { name: "停止录音" }).click();
    const audio = recorder.getByLabel("本页录音预览");
    await expect(audio).toBeVisible();
    await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.duration)).toBeGreaterThan(0);
    await page.screenshot({ path: test.info().outputPath("recording-" + width + ".png") });
  });
}
