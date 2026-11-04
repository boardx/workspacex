import { expect, test, type Page, type Request, type TestInfo } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { DEEP_AGENT_HITL_TOOL_NAME } from "@repo/contracts/deep-agent-hitl";
import { CHAT_READ_E2E, openFreshThread } from "./chat-task-workbench-fixture";
import { sessionHeaders } from "./support/authoritative-thread";
import { selectWorkbenchAgent, submitWorkbenchRun } from "./support/workbench-run-evidence";

// Real chat-read login/API/Postgres/controlled model. No intercepted product route,
// mocked UI, additional warmup, or locale-triggered execution request is allowed.
test.setTimeout(240_000);

async function languageTab(page: Page): Promise<Page> {
  const control = await page.context().newPage();
  // /home is already visited by the shared real-login helper. A second document
  // uses the actual provider BroadcastChannel while Radix owns the first focus trap.
  await control.goto("/home");
  await expect(control.getByTestId("language-switcher")).toBeVisible();
  return control;
}

async function locale(page: Page, control: Page, value: "en" | "zh-CN"): Promise<void> {
  await control.getByTestId("language-switcher").selectOption(value);
  await expect(page.locator("html")).toHaveAttribute("lang", value);
}

async function picture(page: Page, info: TestInfo, name: string): Promise<void> {
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
}

async function sidebar(page: Page, width: number): Promise<void> {
  if (width < 768) await page.getByTestId("copilotkit-v2-mobile-list-toggle").click();
  await expect(page.getByTestId("chat-task-workbench-thread-search")).toBeVisible();
}

async function composerControlsFit(page: Page, width: number): Promise<void> {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  for (const id of ["chat-composer-realtime-voice", "chat-task-workbench-composer-mic", "chat-task-workbench-composer-mic-devices", "copilotkit-v2-send"]) {
    const control = page.getByTestId(id);
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box, `${id} must have real browser geometry`).not.toBeNull();
    expect(box!.x, `${id} left edge must be inside viewport`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `${id} right edge must be inside viewport`).toBeLessThanOrEqual(width);
    expect(box!.y, `${id} top edge must be inside viewport`).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height, `${id} bottom edge must be inside viewport`).toBeLessThanOrEqual(viewport!.height);
  }
}

for (const width of [1280, 375]) {
  test(`personal sidebar and unsent raw draft survive locale changes at ${width}`, async ({ page }, info) => {
    const threadId = await openFreshThread(page);
    await page.setViewportSize({ width, height: 900 });
    const control = await languageTab(page);
    try {
      await locale(page, control, "en");
      const input = page.getByTestId("copilotkit-v2-input");
      const draft = "用户草稿 {raw_code: '不翻译'} / café 🌱";
      await input.fill(draft);
      await input.evaluate(node => (node as HTMLTextAreaElement).setSelectionRange(3, 8));
      const originalInput = await input.elementHandle();
      let executionPosts = 0;
      const countRun = (request: Request) => {
        if (request.method() === "POST" && /\/api\/copilotkit\/agent\/[^/]+\/run(?:\?|$)/.test(request.url())) executionPosts++;
      };
      page.on("request", countRun);
      await locale(page, control, "zh-CN");
      await locale(page, control, "en");
      await expect(input).toHaveValue(draft);
      expect(await input.evaluate((node, original) => node === original, originalInput)).toBe(true);
      expect(await input.evaluate(node => { const field = node as HTMLTextAreaElement; return [field.selectionStart, field.selectionEnd]; })).toEqual([3, 8]);
      expect(executionPosts).toBe(0);
      page.off("request", countRun);
      await picture(page, info, `personal-draft-en-${width}`);
      await composerControlsFit(page, width);

      await sidebar(page, width);
      const row = page.getByTestId(`chat-thread-${threadId}`);
      const actions = row.locator("..");
      await row.hover();
      await actions.getByTestId("chat-thread-card-menu-trigger").click();
      await expect(page.getByTestId("chat-thread-rename")).toHaveText("Rename");
      const menu = await page.getByTestId("chat-thread-card-menu").elementHandle();
      await locale(page, control, "zh-CN");
      await expect(page.getByTestId("chat-thread-rename")).toHaveText("改名");
      expect(await page.getByTestId("chat-thread-card-menu").evaluate((node, original) => node === original, menu)).toBe(true);
      await picture(page, info, `thread-menu-zh-${width}`);
      await page.getByTestId("chat-thread-rename").click();
      const title = `原始标题 {scope} ${threadId}`;
      await page.getByTestId("chat-thread-title-input").fill(title);
      const titleInput = await page.getByTestId("chat-thread-title-input").elementHandle();
      await locale(page, control, "en");
      await expect(page.getByTestId("chat-thread-title-input")).toHaveValue(title);
      expect(await page.getByTestId("chat-thread-title-input").evaluate((node, original) => node === original, titleInput)).toBe(true);
      const saved = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/chat/threads/mutate");
      await page.getByTestId("chat-thread-title-submit").click();
      const response = await saved;
      expect(response.ok()).toBe(true);
      expect(response.request().postDataJSON()).toMatchObject({ op: "rename", threadId, title });
      await expect(row.getByTestId("chat-task-workbench-thread-title")).toHaveText(title);
      const pin = actions.getByTestId("chat-task-workbench-thread-pin");
      await pin.click();
      await expect(pin).toHaveAttribute("aria-pressed", "true");
      await page.getByTestId("chat-task-workbench-thread-search").fill(threadId);
      await expect(row).toBeVisible();
      await expect(row.getByTestId("chat-task-workbench-thread-title")).toHaveText(title);
      await picture(page, info, `thread-search-pin-en-${width}`);
      await page.getByTestId("chat-task-workbench-thread-search").fill("");
      await pin.click();
      await expect(pin).toHaveAttribute("aria-pressed", "false");
    } finally {
      await control.close();
    }
  });
}

test("active canonical run retains identity, raw draft, selected inspector tab and persisted reply across locale/reload", async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const threadId = await openFreshThread(page);
  await selectWorkbenchAgent(page, CHAT_READ_E2E.deepAgentId);
  const control = await languageTab(page);
  try {
    await locale(page, control, "en");
    const tab = page.getByTestId("chat-task-workbench-inspector-tab-run-details");
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    const detailNode = await page.getByTestId("chat-task-workbench-inspector-run-details").elementHandle();
    await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentSlowTrigger);
    const completed = submitWorkbenchRun(page, "").then(
      value => ({ value, error: null }),
      (error: unknown) => ({ value: null, error }),
    );
    await expect(page.getByTestId("copilotkit-v2-running-indicator")).toBeVisible({ timeout: 30_000 });
    const input = page.getByTestId("copilotkit-v2-input");
    const unsent = "下一轮原文 draft {id: 7} 不自动发送";
    await input.fill(unsent);
    const inputNode = await input.elementHandle();
    await locale(page, control, "zh-CN");
    await expect(tab).toHaveAttribute("aria-label", "运行详情");
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(input).toHaveValue(unsent);
    expect(await input.evaluate((node, original) => node === original, inputNode)).toBe(true);
    expect(await page.getByTestId("chat-task-workbench-inspector-run-details").evaluate((node, original) => node === original, detailNode)).toBe(true);
    await picture(page, info, "run-details-active-zh-1280");
    await locale(page, control, "en");
    const outcome = await completed;
    if (outcome.error) throw outcome.error;
    const run = outcome.value!;
    const read = await page.request.get(`/chat/threads/${threadId}/messages?limit=100`, { headers: await sessionHeaders(page) });
    expect(read.ok()).toBe(true);
    const before = await read.json() as { messages: { id: string; text: string; authorKind: string; agentRunId: string | null }[] };
    const human = before.messages.filter(message => message.authorKind === "human" && message.text === CHAT_READ_E2E.deepAgentSlowTrigger);
    expect(human).toHaveLength(1);
    expect(human[0]?.agentRunId).toBe(run.runId);
    const result = before.messages.find(message => message.id === run.resultMessageId);
    expect(result?.agentRunId).toBe(run.runId);
    expect(result?.text.length).toBeGreaterThan(0);
    expect(before.messages.some(message => message.text === unsent)).toBe(false);
    await picture(page, info, "run-details-complete-en-1280");
    const url = page.url();
    await page.reload({ waitUntil: "domcontentloaded" });
    expect(page.url()).toBe(url);
    await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(result!.text, { timeout: 30_000 });
    const restored = await page.request.get(`/chat/threads/${threadId}/messages?limit=100`, { headers: await sessionHeaders(page) });
    expect(restored.ok()).toBe(true);
    const after = await restored.json() as typeof before;
    expect(after.messages.filter(message => message.id === human[0]!.id)).toHaveLength(1);
    expect(after.messages.filter(message => message.id === run.resultMessageId)).toEqual([result]);
    await page.setViewportSize({ width: 375, height: 900 });
    await picture(page, info, "persisted-reply-en-375");
    await composerControlsFit(page, 375);
  } finally {
    await control.close();
  }
});

test("material upload, inline preview and enlarged download retain original bytes across locale changes", async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const threadId = await openFreshThread(page);
  await selectWorkbenchAgent(page, CHAT_READ_E2E.deepAgentId);
  const control = await languageTab(page);
  try {
    await locale(page, control, "en");
    const filename = `原文-${threadId}.txt`;
    const bytes = Buffer.from("用户文件原文\nconst raw = { 中文: 'café 🌱' };\n", "utf8");
    let uploads = 0;
    page.on("request", request => {
      if (request.method() === "POST" && new URL(request.url()).pathname === `/chat/threads/${threadId}/attachments`) uploads++;
    });
    await page.getByTestId("chat-attachment-input").click();
    const uploaded = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === `/chat/threads/${threadId}/attachments`);
    await page.getByTestId("chat-attachment-file-input").setInputFiles({ name: filename, mimeType: "text/plain", buffer: bytes });
    const response = await uploaded;
    expect(response.status()).toBe(201);
    const attachment = await response.json() as { id: string };
    await expect(page.locator('[data-testid^="chat-attach-material-att-chip-"]')).toHaveAttribute("data-status", "uploaded");
    await locale(page, control, "zh-CN");
    await expect(page.getByTestId("chat-attach-material")).toContainText(filename);
    await picture(page, info, "attachment-picker-zh-1280");
    await page.getByTestId("chat-attach-material-confirm").click();
    await page.getByTestId("copilotkit-v2-input").fill("请读取这个附件，保留原文。");
    await submitWorkbenchRun(page, "");
    await page.getByTestId("chat-task-workbench-inspector-tab-materials").click();
    await page.getByTestId(`chat-material-${attachment.id}`).click();
    await expect(page.getByTestId("chat-inspector-file-view")).toContainText(bytes.toString("utf8"));
    await page.getByTestId("chat-inspector-artifact-enlarge").click();
    const dialog = page.getByRole("dialog", { name: filename, exact: true });
    await expect(dialog).toBeVisible();
    const original = await dialog.elementHandle();
    await locale(page, control, "en");
    await expect(page.getByTestId("chat-attachment-preview-dismiss")).toHaveText("Close");
    expect(await dialog.evaluate((node, previous) => node === previous, original)).toBe(true);
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await picture(page, info, `material-preview-en-${width}`);
    }
    await expect(page.getByTestId("chat-attachment-preview-download")).toHaveAttribute("href", /^blob:/);
    const downloadEvent = page.waitForEvent("download");
    await page.getByTestId("chat-attachment-preview-download").click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe(filename);
    expect(await readFile((await download.path())!)).toEqual(bytes);
    expect(uploads).toBe(1);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  } finally {
    await control.close();
  }
});

test("permission dialog locale switch and Escape submit no decision; explicit once resumes the same canonical run", async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const threadId = await openFreshThread(page);
  await selectWorkbenchAgent(page, CHAT_READ_E2E.deepAgentId);
  const control = await languageTab(page);
  try {
    await locale(page, control, "en");
    const pending = page.waitForResponse(async response => {
      if (response.request().method() !== "GET" || !/\/agent-runs\/[^/]+$/.test(new URL(response.url()).pathname) || !response.ok()) return false;
      const run = await response.json();
      return run.threadId === threadId && run.status === "awaiting_tool_permission" && Boolean(run.pendingApproval?.permissionRequestId);
    });
    await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentApprovalTrigger);
    await page.getByTestId("copilotkit-v2-send").click();
    const pendingResponse = await pending;
    const run = await pendingResponse.json() as { runId: string; pendingApproval: { permissionRequestId: string; toolName: string } };
    expect(run.pendingApproval.toolName).toBe(DEEP_AGENT_HITL_TOOL_NAME);
    const decisionPath = `/agent-runs/${run.runId}/permission-requests/${run.pendingApproval.permissionRequestId}/decision`;
    let decisions = 0;
    page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname === decisionPath) decisions++; });
    const dialog = page.getByTestId("chat-tool-permission-dialog");
    await expect(dialog).toBeVisible();
    const original = await dialog.elementHandle();
    await expect(dialog.getByTestId("perm-once")).toContainText("Allow once");
    await locale(page, control, "zh-CN");
    await expect(dialog.getByTestId("perm-once")).toContainText("仅本次允许");
    expect(await dialog.evaluate((node, previous) => node === previous, original)).toBe(true);
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await picture(page, info, `permission-zh-${width}`);
      for (const id of ["chat-tool-permission-dialog", "tool-permission-card", "perm-once", "perm-run", "perm-always", "perm-deny"]) {
        const element = page.getByTestId(id);
        await expect(element).toBeVisible();
        const box = await element.boundingBox();
        expect(box, `${id} has actual browser geometry`).not.toBeNull();
        expect(box!.x, `${id} left edge`).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width, `${id} right edge`).toBeLessThanOrEqual(width);
        expect(box!.y, `${id} top edge`).toBeGreaterThanOrEqual(0);
        expect(box!.y + box!.height, `${id} bottom edge`).toBeLessThanOrEqual(900);
      }
    }
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    expect(decisions).toBe(0);
    // Reopen through the actual restored approval trigger; Escape is not denial.
    await page.getByTestId("restored-run-approval").getByRole("button").click();
    await locale(page, control, "en");
    const decided = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === decisionPath);
    await dialog.getByTestId("perm-once").click();
    const response = await decided;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toEqual({ decision: "once" });
    expect(decisions).toBe(1);
    await expect.poll(async () => {
      const result = await page.request.get(`/agent-runs/${run.runId}`, { headers: await sessionHeaders(page) });
      expect(result.ok()).toBe(true);
      return (await result.json()).status;
    }, { timeout: 60_000 }).toBe("succeeded");
  } finally {
    await control.close();
  }
});

test("project thread preserves canonical scope, raw project name and return target across locales", async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openFreshThread(page);
  const control = await languageTab(page);
  try {
    await locale(page, control, "en");
    const overview = page.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === `/projects/${CHAT_READ_E2E.projectId}/overview`);
    const scopedUrl = `/chat/${CHAT_READ_E2E.threadId}?projectId=${CHAT_READ_E2E.projectId}`;
    await page.goto(scopedUrl);
    const response = await overview;
    expect(response.status()).toBe(200);
    const project = await response.json() as { name: string };
    await expect(page.getByTestId("project-chat-name")).toHaveText(project.name);
    const back = page.getByTestId("project-chat-back");
    const href = await back.getAttribute("href");
    expect(href).toContain(CHAT_READ_E2E.projectId);
    const node = await page.getByTestId("project-chat-context-bar").elementHandle();
    await picture(page, info, "project-context-en-1280");
    await expect(back).toHaveText("Back to project");
    await expect(page.getByTestId("project-chat-context-bar")).toHaveAttribute("aria-label", "Project context");
    await locale(page, control, "zh-CN");
    await expect(back).toHaveText("返回项目");
    await expect(page.getByTestId("project-chat-name")).toHaveText(project.name);
    expect(await page.getByTestId("project-chat-context-bar").evaluate((current, previous) => current === previous, node)).toBe(true);
    await page.setViewportSize({ width: 375, height: 900 });
    await picture(page, info, "project-context-zh-375");
    await locale(page, control, "en");
    await expect(back).toHaveAttribute("href", href!);
    expect(new URL(page.url()).pathname).toBe(`/chat/${CHAT_READ_E2E.threadId}`);
    expect(new URL(page.url()).searchParams.get("projectId")).toBe(CHAT_READ_E2E.projectId);
  } finally {
    await control.close();
  }
});

test("different seeded principal receives real private-thread 404 and locale changes never grant send access", async ({ page, browser, baseURL }, info) => {
  const threadId = await openFreshThread(page);
  const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
  try {
    const denied = await context.newPage();
    await denied.goto("/login");
    await denied.getByTestId("login-email").fill(CHAT_READ_E2E.seedAdminEmail);
    await denied.getByTestId("login-password").fill(CHAT_READ_E2E.password);
    await denied.getByTestId("login-submit").click();
    await expect(denied).toHaveURL(/\/home$/);
    const control = await languageTab(denied);
    const loaded = denied.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === `/chat/threads/${threadId}`);
    await denied.goto(`/chat/${threadId}`);
    expect((await loaded).status()).toBe(404);
    await locale(denied, control, "en");
    const send = denied.getByTestId("copilotkit-v2-send");
    await expect(send).toBeDisabled();
    await expect(send).toHaveAttribute("title", "Send permission is unavailable or has not been confirmed.");
    await expect(denied.getByTestId(`chat-thread-${threadId}`)).toHaveCount(0);
    let writes = 0;
    denied.on("request", request => {
      if (request.method() === "POST" && (/\/api\/copilotkit\/agent\/[^/]+\/run(?:\?|$)/.test(request.url()) || new URL(request.url()).pathname === "/chat/threads/mutate")) writes++;
    });
    const original = await send.elementHandle();
    await locale(denied, control, "zh-CN");
    await expect(send).toBeDisabled();
    expect(await send.evaluate((current, previous) => current === previous, original)).toBe(true);
    await denied.setViewportSize({ width: 375, height: 900 });
    await picture(denied, info, "private-thread-denied-zh-375");
    const skillFailure = denied.getByTestId("chat-skill-mount-failure");
    await expect(skillFailure).toBeVisible();
    const failureBox = await skillFailure.boundingBox();
    const inputBox = await denied.getByTestId("copilotkit-v2-input").boundingBox();
    expect(failureBox).not.toBeNull();
    expect(inputBox).not.toBeNull();
    expect(failureBox!.x).toBeGreaterThanOrEqual(0);
    expect(failureBox!.x + failureBox!.width).toBeLessThanOrEqual(375);
    expect(
      failureBox!.y >= inputBox!.y + inputBox!.height || failureBox!.y + failureBox!.height <= inputBox!.y ||
      failureBox!.x >= inputBox!.x + inputBox!.width || failureBox!.x + failureBox!.width <= inputBox!.x,
      "the persistent skill failure must not obscure the actual draft input",
    ).toBe(true);
    await locale(denied, control, "en");
    await expect(send).toBeDisabled();
    expect(writes).toBe(0);
    const retry = await denied.request.get(`/chat/threads/${threadId}`, { headers: await sessionHeaders(denied) });
    expect(retry.status()).toBe(404);
  } finally {
    await context.close();
  }
});
