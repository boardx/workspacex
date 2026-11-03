import { expect, test } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { FULLSTACK_E2E as F } from "./fullstack-smoke-fixture";

const pathOf = (url: string) => new URL(url).pathname.replace(/^\/__fullstack_api/, "");
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

test("recording locale preserves real capture, final persistence, edits and history", async ({ page, context }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const writes: { method: string; path: string }[] = [];
  const frames: string[] = [];
  let sockets = 0;
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    const path = pathOf(request.url());
    if (path.startsWith("/recording/") && ["POST", "PATCH", "DELETE"].includes(request.method())) writes.push({ method: request.method(), path });
  });
  page.on("websocket", socket => {
    if (!socket.url().includes("/recording/")) return;
    sockets++;
    socket.on("framesent", frame => { if (typeof frame.payload === "string") frames.push(frame.payload); });
  });
  await page.goto("/login");
  await page.getByTestId("language-switcher").selectOption("en");
  await page.getByTestId("login-email").fill(F.email);
  await page.getByTestId("login-password").fill(F.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/);
  const token = await page.evaluate(() => localStorage.getItem("wsx.sessionToken"));
  expect(token).toBeTruthy();
  const headers = { authorization: `Bearer ${token}` };
  const languagePage = await context.newPage();
  await languagePage.goto("/rec");
  const language = async (locale: "en" | "zh-CN") => { await languagePage.getByTestId("language-switcher").first().selectOption(locale); };
  const capture = async (name: string) => {
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll("main, [role=dialog]").forEach(element => { element.scrollTop = 0; element.scrollLeft = 0; }); });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const dialog = page.getByRole("dialog");
      if (await dialog.count()) {
        const box = await dialog.boundingBox(); expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(8); expect(box!.x + box!.width).toBeLessThanOrEqual(width - 8);
        expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      }
      for (const button of await page.locator('[data-testid="rec-live-toggle"], [data-testid="rec-live-save"], [data-testid="rec-create-submit"]').all()) {
        const box = await button.boundingBox(); expect(box).not.toBeNull(); expect(box!.x).toBeGreaterThanOrEqual(8); expect(box!.x + box!.width).toBeLessThanOrEqual(width - 8);
        expect(await button.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      }
      await page.screenshot({ path: test.info().outputPath(`${name}-${width}.png`), fullPage: true });
    }
  };
  await page.goto(`/rec?projectId=${F.projectId}`);
  await expect(page.getByRole("heading", { name: "Transcription history", exact: true })).toBeVisible();
  await page.getByTestId("rec-create-open").click();
  const name = `原始录音 {count} ${randomUUID()}`;
  const rawTag = "原始标签 {count}";
  await page.getByTestId("rec-create-name").fill(name);
  await page.getByTestId("rec-create-tag-input").fill(rawTag);
  const beforeCreate = writes.length;
  await language("zh-CN"); await expect(page.getByRole("heading", { name: "新建转录", exact: true })).toBeVisible();
  await expect(page.getByTestId("rec-create-name")).toHaveValue(name); await expect(page.getByTestId("rec-create-tag-input")).toHaveValue(rawTag);
  await language("en"); await expect(page.getByRole("heading", { name: "New transcription", exact: true })).toBeVisible(); expect(writes).toHaveLength(beforeCreate);
  await capture("create-en");
  const createResponse = page.waitForResponse(response => response.request().method() === "POST" && pathOf(response.url()) === "/recording/realtime-asr/sessions");
  const linkedResponse = page.waitForResponse(response => response.request().method() === "POST" && pathOf(response.url()) === `/projects/${F.projectId}/resources`);
  await page.getByTestId("rec-create-submit").click();
  const created = await createResponse; expect(created.ok()).toBe(true);
  expect(created.request().postDataJSON()).toEqual({ name, tags: [rawTag] });
  const { sessionId } = await created.json() as { sessionId: string }; expect(sessionId).toBeTruthy(); expect((await linkedResponse).ok()).toBe(true);
  await expect(page.getByTestId("rec-live-title")).toHaveText(name);
  const toggle = page.getByTestId("rec-live-toggle");
  await expect(toggle).toHaveText("Start transcription"); await expect(page.getByTestId("rec-live-content")).toHaveCount(0); expect(sockets).toBe(0);
  await capture("workspace-empty-en");
  await page.getByTestId("rec-mic-device-select").click();
  await expect(page.getByTestId("rec-mic-device-option-default")).toHaveAttribute("aria-selected", "true");
  const beforeDeviceSwap = writes.length;
  await language("zh-CN"); await expect(page.getByTestId("rec-mic-device-listbox")).toBeVisible(); await language("en");
  await expect(page.getByTestId("rec-mic-device-option-default")).toHaveAttribute("aria-selected", "true"); expect(writes).toHaveLength(beforeDeviceSwap); expect(sockets).toBe(0);
  await capture("devices-en"); await page.getByTestId("rec-mic-device-option-default").click();
  await toggle.click(); await expect(toggle).toHaveText("Stop transcription", { timeout: 30_000 });
  const captureWrites = writes.length;
  await language("zh-CN"); await expect(toggle).toHaveText("停止转录"); await language("en"); await expect(toggle).toHaveText("Stop transcription");
  expect(writes).toHaveLength(captureWrites); expect(sockets).toBe(1); expect(frames.filter(value => value === '{"type":"start"}')).toHaveLength(1);
  await capture("recording-active-en");
  // Native fake audio must traverse getUserMedia -> PCM -> WebSocket; the
  // controlled provider reports received byte count in its final transcript.
  await page.waitForTimeout(2_000);
  await toggle.click(); await expect(toggle).toHaveText("Continue transcription", { timeout: 30_000 });
  await expect(page.getByTestId("rec-live-error")).toHaveCount(0); await expect(page.getByTestId("rec-live-interim")).toHaveCount(0);
  const transcript = page.getByTestId("rec-live-content");
  await expect(transcript).toContainText(F.asrTranscriptPrefix);
  const recorded = (await transcript.textContent()) ?? "";
  expect(recorded).toMatch(new RegExp(`${F.asrTranscriptPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+[1-9]\\d*`));
  expect(frames.filter(value => value === '{"type":"stop"}')).toHaveLength(1);
  const read = async () => { const response = await page.request.get(`/__fullstack_api/recording/realtime-asr/sessions/${sessionId}`, { headers }); expect(response.ok()).toBe(true); return response.json(); };
  const persisted = await read(); expect(persisted.content).toBe(recorded); expect(persisted.status).toBe("idle"); expect(persisted.durationMs).toBeGreaterThan(0);
  await capture("stopped-en");
  await page.reload(); await page.getByTestId(`rec-history-open-${sessionId}`).click(); await expect(transcript).toHaveText(recorded);
  await page.getByTestId("rec-live-title").dblclick();
  const renamed = name + " 用户改名"; await page.getByRole("textbox", { name: "Recording name", exact: true }).fill(renamed);
  await language("zh-CN"); await expect(page.getByRole("textbox", { name: "录音名称", exact: true })).toHaveValue(renamed); await language("en");
  await capture("rename-en");
  await page.getByRole("button", { name: "Save recording name", exact: true }).click(); await expect(page.getByTestId("rec-live-title")).toHaveText(renamed);
  await page.getByTestId("rec-live-edit").click();
  const edited = recorded + "\n用户修订原文 {count}。"; await page.getByTestId("rec-live-editor").fill(edited);
  const beforeEditSwap = writes.length;
  await language("zh-CN"); await expect(page.getByTestId("rec-live-editor")).toHaveValue(edited); await language("en"); expect(writes).toHaveLength(beforeEditSwap);
  await capture("transcript-edit-en");
  await page.getByTestId("rec-live-save").click(); await expect(page.getByTestId("rec-live-edit")).toBeFocused(); await expect(transcript).toHaveText(edited);
  const saved = await read(); expect(saved.content).toBe(edited); expect(saved.name).toBe(renamed); expect(saved.tags).toEqual([rawTag]);
  const hash = digest(saved.content);
  await language("zh-CN"); await language("en"); expect(digest((await read()).content)).toBe(hash); expect(sockets).toBe(1);
  await page.reload(); await page.getByTestId(`rec-history-open-${sessionId}`).click(); await expect(transcript).toHaveText(edited); await expect(page.getByTestId("rec-live-title")).toHaveText(renamed);
  await capture("reloaded-en");
  await page.getByTestId("rec-live-back").click(); await expect(page.getByTestId(`rec-history-card-${sessionId}`)).toContainText(renamed);
  await page.getByTestId(`rec-history-more-${sessionId}`).click(); await page.getByTestId(`rec-history-edit-${sessionId}`).click(); await capture("metadata-en"); await page.keyboard.press("Escape");
  await page.getByTestId(`rec-history-more-${sessionId}`).click(); await page.getByTestId(`rec-history-delete-${sessionId}`).click(); await capture("delete-en"); await page.keyboard.press("Escape");
  expect((await read()).content).toBe(edited); expect(errors).toEqual([]);
  await test.info().attach("recording-receipt.json", { body: JSON.stringify({ sessionId, projectId: F.projectId, contentSha256: hash, rawName: name, renamed, rawTag, sockets, controlFrames: frames, writes, durationMs: saved.durationMs }, null, 2), contentType: "application/json" });
});

test("recording project previews retain routing and edited controls in both locales", async ({ page, context }) => {
  test.setTimeout(120_000);
  await page.goto("/login"); await page.getByTestId("language-switcher").selectOption("en"); await page.getByTestId("login-email").fill(F.email); await page.getByTestId("login-password").fill(F.password); await page.getByTestId("login-submit").click(); await expect(page).toHaveURL(/\/home$/);
  const localePage = await context.newPage(); await localePage.goto("/rec");
  const change = async (locale: "en" | "zh-CN") => { await localePage.getByTestId("language-switcher").first().selectOption(locale); };
  for (const screen of ["prep", "process", "verify", "live", "assign", "annotate", "retention"] as const) {
    await page.goto(`/rec?mode=project&carrier=interview&as=facilitator&projectId=${F.projectId}&screen=${screen}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const before = page.url();
    if (screen === "live") { await page.getByTestId("rec-transcript-search").fill("用户查询 {count}"); await page.getByTestId("rec-auto-follow").click(); await page.getByTestId("group-mic-toggle").click(); }
    await change("zh-CN"); await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN"); await change("en"); await expect(page.locator("html")).toHaveAttribute("lang", "en"); expect(page.url()).toBe(before);
    if (screen === "live") {
      await expect(page.getByTestId("rec-transcript-search")).toHaveValue("用户查询 {count}"); await expect(page.getByTestId("rec-back-to-latest")).toBeVisible(); await expect(page.getByTestId("group-mic-toggle")).toHaveText("Microphone off · not recording"); await page.getByTestId("rec-transcript-search").clear();
    }
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const heading = page.getByRole("heading", { level: 1 }); const box = await heading.boundingBox(); expect(box).not.toBeNull(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(await heading.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`project-${screen}-en-${width}.png`), fullPage: true });
    }
  }
});
