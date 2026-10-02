import { seedExistingFrame } from "./board-acceptance-support";
import { randomUUID } from "node:crypto";
import { expect, request as playwrightRequest, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { SESSION_TOKEN_STORAGE_KEY } from "../lib/api-client";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";
import { readBoardViewportSnapshot } from "./board-viewport-snapshot";

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
  await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 });
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

// Real Chromium DOM geometry, with the exact transient ACK-removal ordering
// observed in CI #4984. This helper regression does not emulate Board services.
test('viewport snapshot survives ACK banner removal between protocol reads', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(`<style>html,body{margin:0}main{width:100vw;height:100vh;position:relative}section,canvas{position:absolute;inset:0;width:100%;height:100%}aside{position:absolute;top:64px;left:0;width:100%;height:32px}</style><main><section data-testid="board-editor-region"><canvas data-testid="board-fabric-surface"></canvas></section><aside data-testid="board-sync-banner">Pending ACK</aside></main>`);
  const banner = page.getByTestId('board-sync-banner');
  expect(await readBoardViewportSnapshot(page)).toMatchObject({ bannerBounds: { x: 0, y: 64, width: 1280, height: 32 } });
  expect(await banner.isVisible()).toBe(true);
  // An ACK commits between the old isVisible and boundingBox protocol calls.
  await banner.evaluate((element) => element.remove());
  await expect(banner.boundingBox({ timeout: 100 })).rejects.toThrow(/Timeout/);
  const snapshot = await readBoardViewportSnapshot(page);
  expect(snapshot).toEqual({
    bounds: { x: 0, y: 0, width: 1280, height: 800, top: 0, right: 1280, bottom: 800, left: 0 },
    shellBounds: { x: 0, y: 0, width: 1280, height: 800, top: 0, right: 1280, bottom: 800, left: 0 },
    regionBounds: { x: 0, y: 0, width: 1280, height: 800, top: 0, right: 1280, bottom: 800, left: 0 },
    bannerBounds: null, viewport: { width: 1280, height: 800 },
  });
  await page.setViewportSize({ width: 1024, height: 768 });
  expect(await readBoardViewportSnapshot(page)).toMatchObject({ bounds: { width: 1024, height: 768 }, regionBounds: { width: 1024, height: 768 }, bannerBounds: null });
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await readBoardViewportSnapshot(page)).toMatchObject({ bounds: { width: 1280, height: 800 }, regionBounds: { width: 1280, height: 800 }, bannerBounds: null });
  // Genuine geometry drift must remain observable rather than be normalized.
  await page.getByTestId('board-fabric-surface').evaluate((element) => { (element as HTMLElement).style.width = '1275px'; });
  expect((await readBoardViewportSnapshot(page)).bounds?.width).toBe(1275);
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

  const surface = page.getByTestId("board-fabric-surface");
  const canvas = page.getByTestId("board-fabric-canvas");
  await expect(surface).toBeVisible();
  await expect(canvas).toBeVisible();
  // Picking a Sticky shape arms the creation tool; the following canvas click
  // is the user-visible create action. Wait for each canonical projection so a
  // rapid tool sequence cannot hide a lost Yjs command behind a final count.
  const createSticky = async (variant: "square" | "rectangle" | "circle", position: { x: number; y: number }, expected: number) => {
    await page.getByTestId("board-add-sticky").click();
    await page.getByTestId(`board-sticky-${variant}`).click();
    await surface.click({ position });
    await expect(page.getByTestId("board-thinking-editor")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("board-a11y-mirror").locator("li[data-object-id]")).toHaveCount(expected);
  };
  await createSticky("rectangle", { x: 360, y: 250 }, 1);
  await createSticky("circle", { x: 640, y: 250 }, 2);
  await createSticky("square", { x: 920, y: 250 }, 3);
  await page.getByTestId("board-add-text").click();
  await surface.click({position:{x:1040,y:450}});
  await expect(page.getByTestId("board-thinking-editor")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("board-a11y-mirror").locator("li[data-object-id]")).toHaveCount(4);
  const assertViewportBounds = async () => {
    // ACK may remove the optional banner at any time. Separate locator calls
    // race that transition and can wait forever for an already removed banner.
    const { bounds, shellBounds, regionBounds, bannerBounds, viewport } = await readBoardViewportSnapshot(page);
    expect(bounds).not.toBeNull();
    // Sync notices overlay the editor; pending/ACK transitions must never
    // resize the canvas or change its pointer coordinate origin.
    expect(shellBounds).not.toBeNull();
    expect(regionBounds).not.toBeNull();
    for (const [actual, expected] of [
      [shellBounds!.x, 0], [shellBounds!.y, 0],
      [shellBounds!.width, viewport.width], [shellBounds!.height, viewport.height],
      [regionBounds!.x, 0], [regionBounds!.width, viewport.width],
      [regionBounds!.y, 0],
      [regionBounds!.y + regionBounds!.height, viewport.height],
      [bounds!.x, regionBounds!.x], [bounds!.y, regionBounds!.y],
      [bounds!.width, regionBounds!.width], [bounds!.height, regionBounds!.height],
    ]) expect(Math.abs(actual! - expected!)).toBeLessThanOrEqual(1);
    expect(regionBounds!.height).toBeGreaterThan(0);
    if (bannerBounds) {
      expect(bannerBounds).toMatchObject({ x: 0, y: 64, width: viewport.width });
      expect(bannerBounds.height).toBeGreaterThan(0);
    }
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

  const zoomValue = page.getByTestId("board-zoom-value");
  const wheelToClamp = async (deltaY: number, expected: "5%" | "800%") => {
    for (let step = 0; step < 12 && await zoomValue.textContent() !== expected; step += 1) {
      // Wheel input can scroll the page or move an object under the cursor at
      // extreme zoom. Pick an uncovered Fabric pixel before every gesture.
      const point = await surface.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        for (const [fx, fy] of [[0.1, 0.2], [0.9, 0.2], [0.1, 0.8], [0.9, 0.8], [0.5, 0.85]] as const) {
          const x = rect.x + rect.width * fx, y = rect.y + rect.height * fy;
          const hit = document.elementFromPoint(x, y);
          if (hit instanceof HTMLCanvasElement && element.contains(hit)) return { x, y };
        }
        throw new Error("No exposed Fabric canvas point for wheel zoom");
      });
      await page.mouse.move(point.x, point.y);
      await page.keyboard.down("ControlOrMeta");
      await page.mouse.wheel(0, deltaY);
      await page.keyboard.up("ControlOrMeta");
      await page.waitForTimeout(75);
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    }
    await expect(zoomValue).toHaveText(expected);
  };
  await wheelToClamp(2_000, "5%");
  await wheelToClamp(-2_000, "800%");

  // The outline is intentionally screen-reader-only until keyboard focus enters
  // it. Exercise its real accessible interaction instead of clicking through the
  // Fabric upper canvas, which owns pointer input across the full viewport.
  await outlineButtons.first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("board-a11y-selection-announcement")).toHaveText("已选择 1 个对象");
  await page.getByTestId("board-zoom-menu").click();
  const fitSelection = page.getByTestId("board-zoom-fit-selection");
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
  await page.setViewportSize({ width: 1440, height: 800 });
  const token = await login(page);
  const created = await apiRequest(api, token, "POST", "/whiteboards", { requestId: randomUUID(), name: `Selected inspector ${randomUUID()}` });
  const board = await created.json() as { id: string; lifecycleRevision: number };
  boardToArchive = { id: board.id, token, lifecycleRevision: board.lifecycleRevision };
  await page.goto(`/studio/board/${board.id}`);
  await expect(page.getByText(/^已同步$/)).toBeVisible({ timeout: 30_000 });

  const editor = page.getByTestId("collaborative-editor");
  const inspector = page.getByTestId("board-context-toolbar");
  const surface = page.getByTestId("board-fabric-surface");
  const objectRows = page.locator('[data-testid="board-a11y-mirror"] li[data-object-id]');
  const capture = async (name: string) => page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: false });
  const objectIds = () => objectRows.evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.objectId!));
  const expectCreatedObject = async (beforeIds: string[], kind: string, label: string) => {
    await expect(objectRows, `${label} must create exactly one Fabric object`).toHaveCount(beforeIds.length + 1);
    const createdIds = (await objectIds()).filter((id) => !beforeIds.includes(id));
    expect(createdIds, `${label} must expose exactly one new object id`).toHaveLength(1);
    const created = page.locator(`[data-testid="board-a11y-mirror"] li[data-object-id="${createdIds[0]}"]`);
    await expect(created).toHaveAttribute("data-object-kind", kind);
    return created;
  };
  const finishEditingAndSelect = async () => {
    const input = page.getByTestId("board-thinking-editor");
    await input.press("Escape");
    await expect(input).toBeHidden();
    const selectTool = page.getByTestId("board-tool-select");
    await selectTool.click();
    await expect(selectTool).toHaveAttribute("aria-pressed", "true");
  };
  const selectObject = async (object: Locator) => {
    const selectTool = page.getByTestId("board-tool-select");
    await selectTool.click();
    await expect(selectTool).toHaveAttribute("aria-pressed", "true");
    const objectButton = object.getByRole("button");
    await objectButton.evaluate((element: HTMLElement) => element.click());
    await expect(objectButton).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("board-a11y-selection-announcement")).toHaveText("已选择 1 个对象");
    await expect(inspector).toBeVisible();
    return object;
  };
  const expandInspector = async () => {
    if (await page.getByTestId("board-inspector-expand").count()) await page.getByTestId("board-inspector-expand").click();
    await expect(inspector).toHaveAttribute("data-expanded", "true");
  };
  const selectObjectAndExpand = async (object: Locator) => {
    await selectObject(object);
    await expandInspector();
    return object;
  };

  const objectsBeforeSticky = await objectIds();
  await page.getByTestId("board-add-sticky").click();
  await expect(page.getByTestId("board-tool-picker")).toBeVisible();
  await page.getByTestId("board-sticky-square").click();
  await surface.click({ position: { x: 240, y: 180 } });
  await expect(page.getByTestId("board-thinking-editor")).toBeFocused();
  await finishEditingAndSelect();
  const stickyObject = await expectCreatedObject(objectsBeforeSticky, "sticky", "Sticky canvas gesture");
  await selectObjectAndExpand(stickyObject);
  await expect(inspector).toContainText("便利贴");
  await expect(page.getByTestId("board-sticky-size-presets")).toBeVisible();
  await capture("selected-sticky-inspector");
  await page.getByTestId("board-inspector-close").click();

  const objectsBeforeShape = await objectIds();
  await page.getByTestId("board-add-shape").click();
  await surface.click({position:{x:850,y:400}});
  const shapeObject = await expectCreatedObject(objectsBeforeShape, "shape", "Shape quick create");
  await selectObjectAndExpand(shapeObject);
  await expect(inspector).toContainText("形状");
  await expect(page.getByTestId("board-shape-properties")).toBeVisible();
  await expect(page.getByLabel("形状填充色")).toBeVisible();
  await capture("selected-shape-inspector");
  await page.getByTestId("board-inspector-close").click();

  const objectsBeforeText = await objectIds();
  await page.getByTestId("board-add-text").click();
  await surface.click({position:{x:1040,y:450}});
  await expect(page.getByTestId("board-thinking-editor")).toBeFocused();
  await finishEditingAndSelect();
  const textObject = await expectCreatedObject(objectsBeforeText, "text", "Text quick create");
  await selectObjectAndExpand(textObject);
  await expect(inspector).toContainText("文字");
  await expect(inspector.getByTestId("board-widget-quick-format")).toBeVisible();
  await expect(inspector.getByTestId("board-text-quick-bold")).toBeVisible();
  await inspector.getByTestId("board-widget-advanced-format").locator("summary").click();
  await expect(inspector.getByTestId("board-inspector-text")).toBeVisible();
  await capture("selected-text-inspector");
  await page.getByTestId("board-inspector-close").click();

  const objectsBeforeImage = await objectIds();
  await page.getByTestId("board-add-image").click();
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: 32, height: 32 } });
  await page.getByTestId("board-image-input").setInputFiles({ name: "inspector.png", mimeType: "image/png", buffer: png });
  const imageObject = await expectCreatedObject(objectsBeforeImage, "image", "Image upload");
  await selectObject(imageObject);
  await expect(inspector).toHaveAttribute("aria-label", "图片快捷工具");
  await expect(inspector.getByRole("toolbar", { name: "图片快捷操作" })).toBeVisible();
  await expandInspector();
  await expect(inspector).toHaveAttribute("aria-label", "图片属性");
  await expect(inspector).toContainText("图片");
  await expect(page.getByTestId("board-image-properties")).toBeVisible();
  await expect(page.getByLabel("图片裁剪宽度")).toBeVisible();
  await capture("selected-image-inspector");
  await page.getByTestId("board-inspector-close").click();

  const objectsBeforeFrame = await objectIds();
  await seedExistingFrame(page,120,100);
  const frameObject = await expectCreatedObject(objectsBeforeFrame, "panel", "Existing Frame fixture");
  await selectObjectAndExpand(frameObject);
  await expect(inspector).toContainText("Frame / 区域");
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

test("live drag attachments follow before one durable transform and survive undo/redo/reload", async ({ page, request: api }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const token = await login(page);
  const response = await apiRequest(api, token, "POST", "/whiteboards", { requestId: randomUUID(), name: `Live attachments ${randomUUID()}` });
  const board = await response.json() as { id: string; lifecycleRevision: number };
  boardToArchive = { ...board, token };
  const a = randomUUID(), b = randomUUID(), edge = randomUUID();
  const geometry = { x: 220, y: 220, width: 180, height: 140, rotation: 0 };
  const object = (id: string, kind: "sticky" | "connector", value: typeof geometry) => ({ id, schemaVersion: 1, kind, geometry: value, text: id, style: {}, parentId: null, orderKey: id });
  await apiRequest(api, token, "POST", `/v1/whiteboards/${board.id}/operations`, {
    apiVersion: "2026-09-01", requestId: randomUUID(), boardId: board.id, expectedRevision: { epoch: 1, seq: 0 },
    actor: { kind: "human", actorId: FULLSTACK_E2E.adminUserId, orgId: FULLSTACK_E2E.orgId, role: "owner", scopes: ["board:read", "board:write"], delegatedBy: null },
    provenance: { source: "public-api", model: null, skill: null, sourceArtifactId: null, sourceRevision: null, layoutHash: null, inputObjectIds: [] },
    commands: [{ type: "create", object: object(a, "sticky", geometry) }, { type: "create", object: object(b, "sticky", { ...geometry, x: 850, y: 380 }) },
      { type: "create", object: { ...object(edge, "connector", { x: 400, y: 290, width: 450, height: 160, rotation: 0 }), connector: { from: a, to: b, fromAnchor: "right", toAnchor: "left", type: "straight", startStyle: "none", endStyle: "arrow", lineStyle: "solid", label: "Attached", semanticRelation: "" } } }],
  });
  await page.goto(`/studio/board/${board.id}`);
  await expect(page.getByTestId("board-sync-status")).toHaveAttribute("aria-label", /已同步/);
  const surface = page.getByTestId("board-fabric-surface");
  const canonical = () => page.getByTestId("board-a11y-mirror").locator(`li[data-object-id="${a}"]`).getAttribute("data-geometry");
  const scenes = () => surface.evaluate(el => ({ items: JSON.parse(el.getAttribute("data-object-scenes")!) as Array<{ id: string; left: number; top: number; width: number; height: number }>, z: Number(el.getAttribute("data-viewport-zoom")), px: Number(el.getAttribute("data-viewport-pan-x")), py: Number(el.getAttribute("data-viewport-pan-y")), box: el.getBoundingClientRect().toJSON() as { x: number; y: number } }));
  const before = await canonical(), initial = await scenes(), note = initial.items.find(item => item.id === a)!;
  const x = initial.box.x + initial.px + (note.left + note.width / 2) * initial.z, y = initial.box.y + initial.py + (note.top + note.height / 2) * initial.z;
  await page.mouse.click(x, y);
  const toolbar = page.getByTestId("board-context-toolbar"), handle = page.getByTestId(`connector-handle-${a}-right`);
  await expect(toolbar).toBeVisible();
  const menuBefore = (await toolbar.boundingBox())!, handleBefore = (await handle.boundingBox())!;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 100, y + 90, { steps: 8 });
  await expect.poll(async () => Math.abs((await toolbar.boundingBox())!.x - menuBefore.x) + Math.abs((await toolbar.boundingBox())!.y - menuBefore.y)).toBeGreaterThan(20);
  expect(await canonical(), "live drag must not commit before pointer release").toBe(before);
  expect(Math.abs((await handle.boundingBox())!.x - handleBefore.x)).toBeGreaterThan(50);
  const current = await scenes(), moved = current.items.find(item => item.id === a)!, attached = current.items.find(item => item.id === edge)!;
  expect(Math.abs(attached.left - moved.left - moved.width)).toBeLessThan(8);
  await info.attach("live-drag-attachments", { body: await page.screenshot(), contentType: "image/png" });
  await page.mouse.up(); await expect.poll(canonical).not.toBe(before); const after = await canonical();
  await page.getByRole("button", { name: "撤销", exact: true }).click(); await expect.poll(canonical).toBe(before);
  await page.getByRole("button", { name: "重做", exact: true }).click(); await expect.poll(canonical).toBe(after);
  await expect(page.getByTestId("board-sync-status")).toHaveAttribute("aria-label", /已同步/);
  await page.reload(); await expect(page.getByTestId("board-sync-status")).toHaveAttribute("aria-label", /已同步/);
  await expect.poll(canonical).toBe(after);
  await expect(page.getByTestId("board-a11y-mirror").locator("li[data-object-id]")).toHaveCount(3);
});
