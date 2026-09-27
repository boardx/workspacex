import { randomUUID } from "node:crypto";
import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { SESSION_TOKEN_STORAGE_KEY } from "../lib/api-client";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

/** Iteration 05 real-browser acceptance. Root session runs this against isolated API/PG/WS services. */
test.describe.configure({ mode: "default", timeout: 120_000 });
test.use({ actionTimeout: 15_000 });

function required(name: string): string {
  const value = process.env[name] ?? ({ WHITEBOARD_OWNER_EMAIL: FULLSTACK_E2E.adminEmail, WHITEBOARD_OWNER_PASSWORD: FULLSTACK_E2E.adminPassword,
    WHITEBOARD_API_URL: process.env.WORKSPACEX_API_PORT ? `http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}` : undefined } as Record<string, string | undefined>)[name];
  if (!value) throw new Error(`Missing Board spatial E2E fixture: ${name}`);
  return value;
}
async function login(page: Page): Promise<string> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(required("WHITEBOARD_OWNER_EMAIL"));
  await page.getByTestId("login-password").fill(required("WHITEBOARD_OWNER_PASSWORD"));
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
  return (await page.evaluate((key) => localStorage.getItem(key), SESSION_TOKEN_STORAGE_KEY))!;
}
async function apiCall(api: APIRequestContext, token: string, method: string, path: string, data?: unknown) {
  const response = await api.fetch(`${required("WHITEBOARD_API_URL")}${path}`, { method, headers: { Authorization: `Bearer ${token}` }, data });
  expect(response.ok()).toBe(true); return response;
}
let cleanup: { id: string; token: string } | undefined;
test.afterEach(async () => {
  if (!cleanup) return;
  const target = cleanup; cleanup = undefined;
  const api = await playwrightRequest.newContext();
  try {
    const current = await apiCall(api, target.token, "GET", `/whiteboards/${target.id}`);
    const board = await current.json() as { archived: boolean; lifecycleRevision: number };
    if (!board.archived) await apiCall(api, target.token, "PATCH", `/whiteboards/${target.id}`, { archived: true, expectedLifecycleRevision: board.lifecycleRevision });
  } finally { await api.dispose(); }
});

type Geometry = { x: number; y: number; width: number; height: number; rotation: number };
function anchorPoint(geometry: Geometry, anchor: "left" | "right") {
  const radians = geometry.rotation * Math.PI / 180, localX = anchor === "right" ? geometry.width : 0, localY = geometry.height / 2;
  return { x: geometry.x + localX * Math.cos(radians) - localY * Math.sin(radians), y: geometry.y + localX * Math.sin(radians) + localY * Math.cos(radians) };
}
const objectRow = (page: Page, kind: string, index = 0) => page.locator(`[data-testid="board-a11y-mirror"] li[data-object-kind="${kind}"]`).nth(index);
async function geometryOf(row: ReturnType<typeof objectRow>): Promise<Geometry> { return JSON.parse((await row.getAttribute("data-geometry"))!) as Geometry; }
async function canvasTransform(page: Page) {
  const surface = page.getByTestId("board-fabric-surface"), box = (await surface.boundingBox())!;
  return { box, zoom: Number(await surface.getAttribute("data-viewport-zoom")), panX: Number(await surface.getAttribute("data-viewport-pan-x")), panY: Number(await surface.getAttribute("data-viewport-pan-y")) };
}
async function dragObject(page: Page, row: ReturnType<typeof objectRow>, dx: number, dy: number, outcome: "commit" | "reject" = "commit") {
  await row.getByRole("button").focus(); await page.keyboard.press("Enter");
  await expect(page.getByTestId("board-a11y-selection-announcement")).toHaveText("已选择 1 个对象");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const geometry = await geometryOf(row), { box, zoom, panX, panY } = await canvasTransform(page);
  // Canonical geometry is top-left based. Close direct text editing before
  // dragging the interior so the pointer reaches Fabric instead of the textarea.
  await page.keyboard.press("Escape");
  const angle = geometry.rotation * Math.PI / 180;
  const localX = geometry.width / 4, localY = geometry.height / 2;
  const sceneCenter = {
    x: geometry.x + localX * Math.cos(angle) - localY * Math.sin(angle),
    y: geometry.y + localX * Math.sin(angle) + localY * Math.cos(angle),
  };
  const start = { x: box.x + panX + sceneCenter.x * zoom, y: box.y + panY + sceneCenter.y * zoom };
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + dx * zoom, start.y + dy * zoom, { steps: 10 }); await page.mouse.up();
  const expected = outcome === "commit" ? { x: geometry.x + dx, y: geometry.y + dy } : { x: geometry.x, y: geometry.y };
  await expect.poll(async () => { const next = await geometryOf(row); return { x: next.x, y: next.y }; }).toEqual(expected);
}
async function openInspector(page: Page, properties = false) {
  const dialog = page.getByRole("dialog", { name: "更多操作", exact: true });
  if (!await dialog.isVisible()) await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await dialog.getByRole("button", { name: properties ? "精确属性" : "操作", exact: true }).click();
}
async function clickObjectAction(page: Page, name: string) {
  await openInspector(page);
  await page.getByRole("dialog", { name: "更多操作", exact: true }).getByRole("button", { name, exact: true }).click();
}
async function geometries(page: Page): Promise<Geometry[]> {
  return page.locator('[data-testid="board-a11y-mirror"] li').evaluateAll(rows => rows.map(row => JSON.parse((row as HTMLElement).dataset.geometry!) as Geometry));
}
async function boardRows(page: Page) {
  return page.locator('[data-testid="board-a11y-mirror"] li').evaluateAll(rows => rows.map(row => {
    const value = row as HTMLElement;
    return { id: value.dataset.objectId, geometry: value.dataset.geometry, parentId: value.dataset.parentId, zIndex: value.dataset.zIndex, from: value.dataset.connectorFrom, to: value.dataset.connectorTo, start: value.dataset.connectorStart, end: value.dataset.connectorEnd };
  }));
}

test("multi-select transform, Panel clip/expand, connector preservation, and total z-order survive reload", async ({ page, request }) => {
  const token = await login(page);
  const created = await apiCall(request, token, "POST", "/whiteboards", { requestId: randomUUID(), name: `Spatial ${randomUUID()}` });
  const boardId = (await created.json() as { id: string }).id; cleanup = { id: boardId, token };
  await page.goto(`/studio/board/${boardId}`);
  await expect(page.getByText(/^已同步$/)).toBeVisible();

  const outline = page.getByTestId("board-a11y-mirror").getByRole("button");
  await page.getByTestId("board-add-panel").click();
  await expect(outline).toHaveCount(1);
  await page.getByTestId("board-add-sticky").click();
  await expect(outline).toHaveCount(2);
  await page.getByTestId("board-sticky-square").dragTo(page.getByTestId("board-fabric-surface"), { targetPosition: { x: 1050, y: 500 } });
  await expect(outline).toHaveCount(3);
  await page.getByTestId("board-tool-select").click();

  // Real marquee exercises Fabric ActiveSelection; matrix scale/rotation stays covered by
  // the renderer's deterministic Fabric tests until Iteration 06 normalizes its origin.
  const canvas = page.getByTestId("board-fabric-canvas"); const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 80); await page.mouse.down(); await page.mouse.move(box.x + 1250, box.y + 760, { steps: 12 }); await page.mouse.up();
  await expect(page.getByTestId("board-a11y-selection-announcement")).toHaveText("已选择 3 个对象");

  const panel = objectRow(page, "panel");
  const stickyRows = page.locator('[data-testid="board-a11y-mirror"] li[data-object-kind="sticky"]');
  const stickyGeometries = await stickyRows.evaluateAll(rows => rows.map(row => JSON.parse((row as HTMLElement).dataset.geometry!) as Geometry));
  const insideIndex = stickyGeometries.findIndex(value => value.x < 700);
  const firstId = (await stickyRows.nth(insideIndex).getAttribute("data-object-id"))!;
  const secondId = (await stickyRows.nth(insideIndex === 0 ? 1 : 0).getAttribute("data-object-id"))!;
  // Bind by immutable object identity: positional locators retarget after deletion.
  const firstSticky = page.locator(`[data-testid="board-a11y-mirror"] li[data-object-id="${firstId}"]`);
  const secondSticky = page.locator(`[data-testid="board-a11y-mirror"] li[data-object-id="${secondId}"]`);
  const panelId = (await panel.getAttribute("data-object-id"))!;
  // Give the first Sticky a canonical parent through a completed Fabric gesture.
  await dragObject(page, firstSticky, 12, 8);
  await expect(firstSticky).toHaveAttribute("data-parent-id", panelId);

  // Panel policies are mutually exclusive. A rotated/absolute Fabric clipPath is projected for its child and blocks escape atomically.
  await panel.getByRole("button").focus(); await page.keyboard.press("Enter");
  await openInspector(page, true);
  await page.getByLabel("自动扩展").uncheck(); await page.getByLabel("裁剪内容").check();
  await expect(page.getByLabel("自动扩展")).toBeDisabled();
  await expect(firstSticky).toHaveAttribute("data-clip-parent-id", panelId);
  const clippedGeometry = await firstSticky.getAttribute("data-geometry");
  await dragObject(page, firstSticky, 620, 420, "reject");
  await expect(firstSticky).toHaveAttribute("data-geometry", clippedGeometry!);

  // With auto-expand enabled, the same boundary crossing retains parentId and expands the Panel.
  const panelBeforeExpand = await geometryOf(panel);
  await panel.getByRole("button").focus(); await page.keyboard.press("Enter");
  await openInspector(page, true);
  await page.getByLabel("裁剪内容").uncheck(); await page.getByLabel("自动扩展").check();
  await dragObject(page, firstSticky, 620, 320);
  const panelAfterExpand = await geometryOf(panel);
  expect(panelAfterExpand.width > panelBeforeExpand.width || panelAfterExpand.height > panelBeforeExpand.height).toBe(true);
  await expect(firstSticky).toHaveAttribute("data-parent-id", panelId);

  // A locked sibling keeps its exact zIndex while one-step layer movement swaps only one relative position.
  await panel.getByRole("button").focus(); await page.keyboard.press("Enter");
  await clickObjectAction(page, "锁定");
  const lockedPanelZ = Number(await panel.getAttribute("data-z-index"));
  await secondSticky.getByRole("button").focus(); await page.keyboard.press("Enter");
  await clickObjectAction(page, "置于底层");
  await clickObjectAction(page, "上移一层");
  // A locked anchor can make a one-step command a legitimate no-op at its
  // boundary; the invariant is that the anchor stays fixed and total order
  // remains unique through all four commands.
  expect(Number(await panel.getAttribute("data-z-index"))).toBe(lockedPanelZ);
  for (const label of ["置于顶层", "下移一层", "置于底层"]) await clickObjectAction(page, label);
  const zBeforeReload = await page.locator('[data-testid="board-a11y-mirror"] li').evaluateAll(rows => rows.map(row => Number((row as HTMLElement).dataset.zIndex)));
  expect(new Set(zBeforeReload).size).toBe(zBeforeReload.length);
  await panel.getByRole("button").focus(); await page.keyboard.press("Enter");
  await clickObjectAction(page, "解锁");

  // Explicit endpoint deletion keeps a free endpoint connector; the other attached end remains live.
  await firstSticky.getByRole("button").focus(); await page.keyboard.press("Enter");
  await page.getByTestId(`connector-handle-${firstId}-right`).evaluate(element => {
    const transfer = new DataTransfer(); (window as typeof window & { __boardConnectorTransfer?: DataTransfer }).__boardConnectorTransfer = transfer;
    element.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
  });
  await secondSticky.getByRole("button").focus(); await page.keyboard.press("Enter");
  await page.getByTestId(`connector-handle-${secondId}-left`).evaluate(element => {
    const transfer = (window as typeof window & { __boardConnectorTransfer?: DataTransfer }).__boardConnectorTransfer!;
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
  });
  const connector = objectRow(page, "connector");
  const connectorStart = JSON.parse((await connector.getAttribute("data-connector-start"))!) as { x: number; y: number };
  const connectorEnd = JSON.parse((await connector.getAttribute("data-connector-end"))!) as { x: number; y: number };
  const expectedStart = anchorPoint(await geometryOf(firstSticky), "right"), expectedEnd = anchorPoint(await geometryOf(secondSticky), "left");
  expect(connectorStart.x).toBeCloseTo(expectedStart.x, 5); expect(connectorStart.y).toBeCloseTo(expectedStart.y, 5);
  expect(connectorEnd.x).toBeCloseTo(expectedEnd.x, 5); expect(connectorEnd.y).toBeCloseTo(expectedEnd.y, 5);
  const connectorStartBeforeMove = await connector.getAttribute("data-connector-start");
  await dragObject(page, firstSticky, 40, 30);
  await expect(connector).not.toHaveAttribute("data-connector-start", connectorStartBeforeMove!);
  await firstSticky.getByRole("button").focus(); await page.keyboard.press("Enter");
  await openInspector(page);
  await page.getByTestId("board-delete-preserve-connectors").click();
  await expect(page.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(3);
  await expect(connector).toHaveAttribute("data-connector-from", "");
  await expect(connector).toHaveAttribute("data-connector-to", secondId);
  const peer = await page.context().newPage();
  await peer.goto(`/studio/board/${boardId}`); await expect(peer.getByText(/^已同步$/)).toBeVisible();
  await expect.poll(() => boardRows(peer)).toEqual(await boardRows(page));

  const expectedRows = await boardRows(page);
  await expect.poll(() => boardRows(peer)).toEqual(expectedRows);

  await page.reload(); await expect(page.getByText(/^已同步$/)).toBeVisible();
  await expect(page.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(3);
  const reloadedRows = await boardRows(page);
  expect(reloadedRows).toEqual(expectedRows);
  await peer.close();
});

async function openEmptyBoard(page: Page, request: APIRequestContext, prefix: string) {
  const token = await login(page);
  const created = await apiCall(request, token, "POST", "/whiteboards", { requestId: randomUUID(), name: `${prefix} ${randomUUID()}` });
  const boardId = (await created.json() as { id: string }).id;
  cleanup = { id: boardId, token };
  await page.goto(`/studio/board/${boardId}`);
  await expect(page.getByText(/^已同步$/)).toBeVisible();
  return boardId;
}

test("selection transform locks", async ({ page, request }) => {
  await openEmptyBoard(page, request, "Selection locks");
  await page.getByTestId("board-add-sticky").click();
  await page.keyboard.press("Escape");
  await page.getByTestId("board-sticky-square").dragTo(page.getByTestId("board-fabric-surface"), { targetPosition: { x: 950, y: 470 } });
  await page.getByTestId("board-tool-select").click();
  const stickies = page.locator('[data-testid="board-a11y-mirror"] li[data-object-kind="sticky"]');
  await expect(stickies).toHaveCount(2);
  const locked = stickies.nth(0), free = stickies.nth(1);
  const lockedBefore = await geometryOf(locked), freeBefore = await geometryOf(free);
  await locked.getByRole("button").focus();
  await page.keyboard.press("Enter");
  await clickObjectAction(page, "锁定");
  await expect(page.getByTestId("board-spatial-duplicate")).toBeDisabled();
  const canvas = page.getByTestId("board-fabric-canvas"), box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 70); await page.mouse.down(); await page.mouse.move(box.x + 1180, box.y + 700, { steps: 10 }); await page.mouse.up();
  await expect(page.getByTestId("board-a11y-selection-announcement")).toHaveText("已选择 2 个对象");
  const transform = await canvasTransform(page);
  const start = { x: transform.box.x + transform.panX + (freeBefore.x + freeBefore.width / 4) * transform.zoom, y: transform.box.y + transform.panY + (freeBefore.y + freeBefore.height / 2) * transform.zoom };
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 90 * transform.zoom, start.y + 60 * transform.zoom, { steps: 10 }); await page.mouse.up();
  await expect.poll(() => geometryOf(free)).toMatchObject({ x: freeBefore.x + 90, y: freeBefore.y + 60 });
  expect(await geometryOf(locked)).toEqual(lockedBefore);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect.poll(() => geometryOf(free)).toEqual(freeBefore);
  expect(await geometryOf(locked)).toEqual(lockedBefore);
  await locked.getByRole("button").focus(); await page.keyboard.press("Enter");
  await clickObjectAction(page, "解锁");
});

test("copy paste sanitization", async ({ page, request }) => {
  await openEmptyBoard(page, request, "Clipboard sanitization");
  await page.getByTestId("board-add-sticky").click();
  await page.keyboard.press("Escape");
  const outline = page.getByTestId("board-a11y-mirror").getByRole("button");
  await expect(outline).toHaveCount(1);
  const originalId = await objectRow(page, "sticky").getAttribute("data-object-id");
  const originalGeometry = await geometryOf(objectRow(page, "sticky"));
  await page.keyboard.press(process.platform === "darwin" ? "Meta+C" : "Control+C");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+V" : "Control+V");
  await expect(outline).toHaveCount(2);
  const ids = await page.locator('[data-testid="board-a11y-mirror"] li').evaluateAll(rows => rows.map(row => (row as HTMLElement).dataset.objectId));
  expect(new Set(ids).size).toBe(2);
  expect(ids).toContain(originalId);
  const pasted = await geometryOf(page.locator(`[data-testid="board-a11y-mirror"] li[data-object-id]:not([data-object-id="${originalId}"])`).first());
  expect(pasted).toMatchObject({ x: originalGeometry.x + 24, y: originalGeometry.y + 24 });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+D" : "Control+D");
  await expect(outline).toHaveCount(3);
  const selectedRow = page.locator('[data-testid="board-a11y-mirror"] li').filter({ has: page.locator('button[aria-pressed="true"]') }).first();
  const selectedId = (await selectedRow.getAttribute("data-object-id"))!, selectedBefore = await geometryOf(selectedRow);
  const beforeAltIds = new Set(await page.locator('[data-testid="board-a11y-mirror"] li[data-object-id]').evaluateAll(rows => rows.map(row => (row as HTMLElement).dataset.objectId!)));
  const surfaceTransform = await canvasTransform(page);
  // The three copies overlap by 24 px. Start in the selected copy's exposed
  // right strip so Fabric cannot retarget the Alt-drag to an older copy below.
  const dragStart = { x: surfaceTransform.box.x + surfaceTransform.panX + (selectedBefore.x + selectedBefore.width / 2 - 12) * surfaceTransform.zoom, y: surfaceTransform.box.y + surfaceTransform.panY + selectedBefore.y * surfaceTransform.zoom };
  await page.keyboard.down("Alt");
  await page.mouse.move(dragStart.x, dragStart.y); await page.mouse.down(); await page.mouse.move(dragStart.x + 36 * surfaceTransform.zoom, dragStart.y + 28 * surfaceTransform.zoom, { steps: 8 }); await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect(outline).toHaveCount(4);
  expect(await geometryOf(page.locator(`[data-testid="board-a11y-mirror"] li[data-object-id="${selectedId}"]`))).toEqual(selectedBefore);
  const altCopyId = await page.locator('[data-testid="board-a11y-mirror"] li[data-object-id]').evaluateAll((rows, previousIds) => {
    const previous = new Set(previousIds as string[]);
    return rows.map(row => (row as HTMLElement).dataset.objectId!).find(id => !previous.has(id));
  }, [...beforeAltIds]);
  expect(altCopyId).toBeTruthy();
  const altCopy = page.locator(`[data-testid="board-a11y-mirror"] li[data-object-id="${altCopyId}"]`);
  const altGeometry = await geometryOf(altCopy);
  expect(altGeometry.x).toBe(selectedBefore.x + 36);
  expect(altGeometry.y).toBeGreaterThan(selectedBefore.y);
  expect({ x: altGeometry.x - selectedBefore.x, y: altGeometry.y - selectedBefore.y }).not.toEqual({ x: 24, y: 24 });

  await page.getByTestId("collaborative-editor").evaluate(element => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "<img src=x onerror=alert(1)>\n<script>globalThis.__boardPwned=true</script>");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }));
  });
  await expect(page.getByRole("dialog", { name: "如何放入这些内容？" })).toBeVisible();
  await page.getByTestId("board-paste-stickies").click();
  await expect(outline).toHaveCount(6);
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { __boardPwned?: boolean }).__boardPwned)).toBeUndefined();
  expect(await page.locator("script").filter({ hasText: "__boardPwned" }).count()).toBe(0);
});

test("contextual controls availability", async ({ page, request }) => {
  await openEmptyBoard(page, request, "Context availability");
  await page.getByTestId("board-add-sticky").click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("complementary", { name: "便利贴快捷工具" })).toBeVisible();
  await openInspector(page);
  const spatial = page.getByTestId("board-spatial-toolbar");
  await expect(spatial.getByRole("button", { name: "组合", exact: true })).toBeDisabled();
  await expect(spatial.getByRole("button", { name: "组合", exact: true })).toHaveAttribute("title", "至少选择 2 个对象");
  await expect(page.getByTestId("board-command-availability")).toContainText("至少选择 2 个对象");
  await openInspector(page, true);
  await expect(page.getByTestId("board-shared-properties")).toContainText("对象属性");
  await expect(page.getByLabel("共有属性 类型")).toHaveValue("sticky");
  await openInspector(page);
  await expect(spatial.getByRole("button", { name: "复制副本", exact: true })).toBeEnabled();
  await clickObjectAction(page, "锁定");
  await expect(spatial.getByRole("button", { name: "复制副本", exact: true })).toBeDisabled();
  await expect(spatial.getByRole("button", { name: "复制副本", exact: true })).toHaveAttribute("title", "选择中包含锁定对象");
  await expect(page.getByRole("complementary", { name: "便利贴快捷工具" })).toHaveCount(0);
});
