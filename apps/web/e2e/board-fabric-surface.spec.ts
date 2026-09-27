import { randomUUID } from "node:crypto";
import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { SESSION_TOKEN_STORAGE_KEY } from "../lib/api-client";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

/** Real services only: authenticated UI, HTTP Board lifecycle and the production collaboration route. */
test.describe.configure({ mode: "serial", timeout: 120_000 });

function required(name: string): string {
  const fallbacks: Record<string, string | undefined> = {
    WHITEBOARD_OWNER_EMAIL: FULLSTACK_E2E.adminEmail,
    WHITEBOARD_OWNER_PASSWORD: FULLSTACK_E2E.adminPassword,
    WHITEBOARD_API_URL: process.env.WORKSPACEX_API_PORT ? `http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}` : undefined,
  };
  const value = process.env[name] ?? fallbacks[name];
  if (!value) throw new Error(`Missing real Board Fabric E2E fixture: ${name}`);
  return value;
}

async function login(page: Page): Promise<string> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(required("WHITEBOARD_OWNER_EMAIL"));
  await page.getByTestId("login-password").fill(required("WHITEBOARD_OWNER_PASSWORD"));
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });
  const token = await page.evaluate((key) => localStorage.getItem(key), SESSION_TOKEN_STORAGE_KEY);
  expect(token, "real login issued session token").toBeTruthy();
  return token!;
}

async function apiRequest(api: APIRequestContext, token: string, method: string, path: string, data?: unknown) {
  const response = await api.fetch(`${required("WHITEBOARD_API_URL").replace(/\/$/, "")}${path}`, { method, headers: { Authorization: `Bearer ${token}` }, data });
  expect(response.ok(), `${method} ${path} returned ${response.status()}`).toBe(true);
  return response;
}

let boardToArchive: { id: string; token: string; lifecycleRevision: number } | undefined;

test.afterEach(async () => {
  const target = boardToArchive;
  boardToArchive = undefined;
  if (!target) return;

  // The browser context is deliberately not used for cleanup. A timed-out page is
  // closed before its request fixture can finish, while this API context belongs to
  // the afterEach hook and therefore retains the hook's independent timeout budget.
  const cleanupApi = await playwrightRequest.newContext();
  try {
    await apiRequest(cleanupApi, target.token, "PATCH", `/whiteboards/${target.id}`, { archived: true, expectedLifecycleRevision: target.lifecycleRevision });
  } finally {
    await cleanupApi.dispose();
  }
});

test("fabric surface viewport", async ({ page, request: api }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const token = await login(page);
  const created = await apiRequest(api, token, "POST", "/whiteboards", { requestId: randomUUID(), name: `Fabric surface ${randomUUID()}` });
  const board = await created.json() as { id: string; lifecycleRevision: number };
  const boardId = board.id;
  boardToArchive = { id: boardId, token, lifecycleRevision: board.lifecycleRevision };
  await page.goto(`/studio/board/${boardId}`);
  await expect(page.getByTestId("collaborative-editor")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^已同步$/)).toBeVisible({ timeout: 30_000 });

  // Iteration 03 replaces the legacy rectangle/ellipse quick-add buttons with
  // the Sticky-first picker. Exercise the three canonical Sticky variants and
  // Text through the production bottom dock.
  await page.getByTestId("board-add-sticky").click();
  await page.getByTestId("board-sticky-rectangle").click();
  await page.getByTestId("board-add-sticky").click();
  await page.getByTestId("board-sticky-circle").click();
  await page.getByTestId("board-add-sticky").click();
  await page.getByTestId("board-add-text").click();

  const surface = page.getByTestId("board-fabric-surface");
  const canvas = page.getByTestId("board-fabric-canvas");
  await expect(surface).toBeVisible();
  await expect(canvas).toBeVisible();
  const assertViewportBounds = async () => {
    const bounds = await surface.boundingBox();
    expect(bounds).not.toBeNull();
    // Fullscreen belongs to the Board shell, including its visible sync/recovery
    // status. Fabric fills the remaining editor region, not the status banner.
    // Measure every boundary; a hardcoded banner allowance could hide app chrome.
    const region = page.getByTestId("board-editor-region");
    const shellBounds = await region.locator("..").boundingBox();
    const regionBounds = await region.boundingBox();
    const bannerBounds = await page.getByTestId("board-sync-banner").boundingBox();
    const viewport = page.viewportSize()!;
    expect(shellBounds).not.toBeNull();
    expect(regionBounds).not.toBeNull();
    expect(bannerBounds).not.toBeNull();
    for (const [actual, expected] of [
      [shellBounds!.x, 0], [shellBounds!.y, 0],
      [shellBounds!.width, viewport.width], [shellBounds!.height, viewport.height],
      [bannerBounds!.x, 0], [bannerBounds!.y, 0], [bannerBounds!.width, viewport.width],
      [regionBounds!.x, 0], [regionBounds!.width, viewport.width],
      [regionBounds!.y, bannerBounds!.y + bannerBounds!.height],
      [regionBounds!.y + regionBounds!.height, viewport.height],
      [bounds!.x, regionBounds!.x], [bounds!.y, regionBounds!.y],
      [bounds!.width, regionBounds!.width], [bounds!.height, regionBounds!.height],
    ]) expect(Math.abs(actual! - expected!)).toBeLessThanOrEqual(1);
    expect(regionBounds!.height).toBeGreaterThan(0);
    expect(bannerBounds!.height).toBeGreaterThan(0);
  };
  await expect(assertViewportBounds).toPass({timeout: 5000});
  await page.setViewportSize({width: 1024, height: 768});
  await expect(assertViewportBounds).toPass({timeout: 5000});
  await page.setViewportSize({width: 1280, height: 800});
  await expect(assertViewportBounds).toPass({timeout: 5000});

  await expect(page.locator('[data-testid^="whiteboard-object-"]')).toHaveCount(0);
  const mirror = page.getByTestId("board-a11y-mirror");
  await expect(mirror).toBeAttached();
  const outlineButtons = mirror.getByRole("button");
  await expect(outlineButtons).toHaveCount(4);

  const paintedSamples = await canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement;
    const context = target.getContext("2d");
    if (!context) return 0;
    const pixels = context.getImageData(0, 0, target.width, target.height).data;
    let painted = 0;
    for (let offset = 3; offset < pixels.length; offset += 4 * 64) if (pixels[offset] !== 0) painted += 1;
    return painted;
  });
  expect(paintedSamples).toBeGreaterThan(10);

  for (let index = 0; index < 40; index += 1) await page.getByTestId("board-zoom-out").click();
  await expect(page.getByTestId("board-zoom-value")).toHaveText("5%");
  for (let index = 0; index < 80; index += 1) await page.getByTestId("board-zoom-in").click();
  await expect(page.getByTestId("board-zoom-value")).toHaveText("800%");

  const fitSelection = page.getByTestId("board-zoom-fit-selection");
  // The outline is intentionally screen-reader-only until keyboard focus enters
  // it. Exercise its real accessible interaction instead of clicking through the
  // Fabric upper canvas, which owns pointer input across the full viewport.
  await outlineButtons.first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("board-a11y-selection-announcement")).toHaveText("已选择 1 个对象");
  await expect(fitSelection).toBeEnabled();
  await fitSelection.click();
  await page.getByTestId("board-zoom-fit-board").click();

  const beforePan = await canvas.screenshot();
  await page.getByTestId("board-tool-hand").click();
  const canvasBounds = await canvas.boundingBox();
  expect(canvasBounds).not.toBeNull();
  await page.mouse.move(canvasBounds!.x + 400, canvasBounds!.y + 300);
  await page.mouse.down();
  await page.mouse.move(canvasBounds!.x + 520, canvasBounds!.y + 380, { steps: 8 });
  await page.mouse.up();
  const afterPan = await canvas.screenshot();
  expect(afterPan.equals(beforePan)).toBe(false);
});

test("selected object inspector adapts to each widget and a narrow editor", async ({ page, request: api }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const token = await login(page);
  const created = await apiRequest(api, token, "POST", "/whiteboards", { requestId: randomUUID(), name: `Selected inspector ${randomUUID()}` });
  const board = await created.json() as { id: string; lifecycleRevision: number };
  boardToArchive = { id: board.id, token, lifecycleRevision: board.lifecycleRevision };
  await page.goto(`/studio/board/${board.id}`);
  await expect(page.getByText(/^已同步$/)).toBeVisible({ timeout: 30_000 });

  const editor = page.getByTestId("collaborative-editor");
  const inspector = page.getByTestId("board-context-toolbar");
  const capture = async (name: string) => page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: false });
  const latestObject = () => page.locator('[data-testid="board-a11y-mirror"] li[data-object-id]').last();
  const selectLatestAndExpand = async () => {
    const object = latestObject();
    await object.getByRole("button").focus();
    await page.keyboard.press("Enter");
    await expect(inspector).toBeVisible();
    if (await page.getByTestId("board-inspector-expand").count()) await page.getByTestId("board-inspector-expand").click();
    await expect(inspector).toHaveAttribute("data-expanded", "true");
    return object;
  };

  await page.getByTestId("board-add-sticky").click();
  await selectLatestAndExpand();
  await expect(inspector).toContainText("便利贴");
  await expect(page.getByTestId("board-sticky-size-presets")).toBeVisible();
  await capture("selected-sticky-inspector");
  await page.getByTestId("board-inspector-close").click();

  await page.getByTestId("board-add-shape").click();
  await selectLatestAndExpand();
  await expect(inspector).toContainText("形状");
  await expect(page.getByTestId("board-shape-properties")).toBeVisible();
  await expect(page.getByLabel("形状填充色")).toBeVisible();
  await capture("selected-shape-inspector");
  await page.getByTestId("board-inspector-close").click();

  await page.getByTestId("board-add-text").click();
  await page.keyboard.press("Escape");
  await selectLatestAndExpand();
  await expect(inspector).toContainText("文字");
  await expect(page.locator('[aria-label="文字快捷样式"]')).toBeVisible();
  await capture("selected-text-inspector");
  await page.getByTestId("board-inspector-close").click();

  await page.getByTestId("board-add-image").click();
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: 32, height: 32 } });
  await page.getByTestId("board-image-input").setInputFiles({ name: "inspector.png", mimeType: "image/png", buffer: png });
  await expect(page.getByText(/图片已在当前浏览器会话中验证并显示/)).toBeVisible({ timeout: 15_000 });
  await selectLatestAndExpand();
  await expect(inspector).toContainText("图片");
  await expect(page.getByTestId("board-image-properties")).toBeVisible();
  await expect(page.getByLabel("图片裁剪宽度")).toBeVisible();
  await capture("selected-image-inspector");
  await page.getByTestId("board-inspector-close").click();

  await page.getByTestId("board-add-panel").click();
  await selectLatestAndExpand();
  await expect(inspector).toContainText("Frame");
  await expect(page.getByTestId("board-frame-size-presets")).toBeVisible();
  await capture("selected-frame-inspector");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(inspector).toHaveAttribute("data-expanded", "true");
  const editorBox = await editor.boundingBox();
  const panelBox = await inspector.boundingBox();
  expect(editorBox).not.toBeNull();
  expect(panelBox).not.toBeNull();
  expect(panelBox!.x).toBeGreaterThanOrEqual(editorBox!.x);
  expect(panelBox!.y).toBeGreaterThanOrEqual(editorBox!.y);
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(editorBox!.x + editorBox!.width + 1);
  expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(editorBox!.y + editorBox!.height + 1);
  const widthResizer = page.getByTestId("board-inspector-resize");
  const heightResizer = page.getByTestId("board-inspector-resize-height");
  const previousWidth = Number(await widthResizer.getAttribute("aria-valuenow"));
  await widthResizer.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(widthResizer).toHaveAttribute("aria-valuenow", String(previousWidth - 24));
  const previousHeight = Number(await heightResizer.getAttribute("aria-valuenow"));
  await heightResizer.focus();
  await page.keyboard.press("ArrowDown");
  await expect(heightResizer).toHaveAttribute("aria-valuenow", String(previousHeight - 24));
  await expect(page.getByTestId("board-inspector-scroll-content")).toBeVisible();
  await capture("selected-inspector-narrow");
});
