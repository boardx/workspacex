import { randomUUID } from "node:crypto";
import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { SESSION_TOKEN_STORAGE_KEY } from "../lib/api-client";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

/** Iteration 05 real-browser acceptance. Root session runs this against isolated API/PG/WS services. */
test.describe.configure({ mode: "serial", timeout: 120_000 });

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
test.afterEach(async () => { if (!cleanup) return; const api = await playwrightRequest.newContext(); try { await apiCall(api, cleanup.token, "PATCH", `/whiteboards/${cleanup.id}`, { archived: true }); } finally { cleanup = undefined; await api.dispose(); } });

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
  const geometry = await geometryOf(row), { box, zoom, panX, panY } = await canvasTransform(page), radians = geometry.rotation * Math.PI / 180;
  const sceneCenter = {
    x: geometry.x + geometry.width / 2 * Math.cos(radians) - geometry.height / 2 * Math.sin(radians),
    y: geometry.y + geometry.width / 2 * Math.sin(radians) + geometry.height / 2 * Math.cos(radians),
  };
  const start = { x: box.x + panX + sceneCenter.x * zoom, y: box.y + panY + sceneCenter.y * zoom };
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + dx * zoom, start.y + dy * zoom, { steps: 10 }); await page.mouse.up();
  const expected = outcome === "commit" ? { x: geometry.x + dx, y: geometry.y + dy } : { x: geometry.x, y: geometry.y };
  await expect.poll(async () => { const next = await geometryOf(row); return { x: next.x, y: next.y }; }).toEqual(expected);
}
async function geometries(page: Page): Promise<Geometry[]> {
  return page.locator('[data-testid="board-a11y-mirror"] li').evaluateAll(rows => rows.map(row => JSON.parse((row as HTMLElement).dataset.geometry!) as Geometry));
}
async function activeSelectionBounds(page: Page) {
  const values = await geometries(page);
  return { left: Math.min(...values.map(value => value.x)), top: Math.min(...values.map(value => value.y)), right: Math.max(...values.map(value => value.x + value.width)), bottom: Math.max(...values.map(value => value.y + value.height)) };
}
async function transformActiveSelection(page: Page, kind: "scale" | "rotate") {
  const bounds = await activeSelectionBounds(page), { box, zoom, panX, panY } = await canvasTransform(page);
  const client = (x: number, y: number) => ({ x: box.x + panX + x * zoom, y: box.y + panY + y * zoom });
  const center = client((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2), corner = client(bounds.right, bounds.bottom), top = client((bounds.left + bounds.right) / 2, bounds.top);
  const start = kind === "scale" ? corner : { x: top.x, y: top.y - 40 };
  const end = kind === "scale" ? { x: start.x + 120, y: start.y + 80 } : { x: client(bounds.right, bounds.top).x + 40, y: center.y };
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 16 }); await page.mouse.up();
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

  await page.getByTestId("board-add-panel").click();
  await page.getByTestId("board-add-sticky").click();
  await page.getByTestId("board-sticky-square").dragTo(page.getByTestId("board-fabric-surface"), { targetPosition: { x: 1050, y: 220 } });
  const outline = page.getByTestId("board-a11y-mirror").getByRole("button");
  await expect(outline).toHaveCount(3);

  // Real marquee, corner scale, and rotation-handle drag exercise Fabric ActiveSelection's scene-matrix bridge.
  const canvas = page.getByTestId("board-fabric-canvas"); const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 80); await page.mouse.down(); await page.mouse.move(box.x + 1250, box.y + 760, { steps: 12 }); await page.mouse.up();
  await expect(page.getByTestId("board-a11y-selection-announcement")).toHaveText("已选择 3 个对象");
  const beforeScale = await geometries(page);
  await transformActiveSelection(page, "scale");
  await expect(page.getByText("已用一次操作更新 3 个对象。")).toBeVisible();
  const afterScale = await geometries(page);
  expect(afterScale.map((value, index) => value.width - beforeScale[index]!.width).every(delta => delta > 0)).toBe(true);
  expect(afterScale.map((value, index) => value.height - beforeScale[index]!.height).every(delta => delta > 0)).toBe(true);
  await transformActiveSelection(page, "rotate");
  const afterRotate = await geometries(page);
  const rotationDeltas = afterRotate.map((value, index) => value.rotation - afterScale[index]!.rotation);
  expect(Math.abs(rotationDeltas[0]!)).toBeGreaterThan(30);
  expect(rotationDeltas.every(delta => Math.abs(delta - rotationDeltas[0]!) < 1)).toBe(true);

  const panel = objectRow(page, "panel"), firstSticky = objectRow(page, "sticky"), secondSticky = objectRow(page, "sticky", 1);
  const panelId = (await panel.getAttribute("data-object-id"))!;
  const secondId = (await secondSticky.getAttribute("data-object-id"))!;
  expect(Math.abs((await geometryOf(panel)).rotation)).toBeGreaterThan(30);
  // Give the first Sticky a canonical parent through a completed Fabric gesture.
  await dragObject(page, firstSticky, 12, 8);
  await expect(firstSticky).toHaveAttribute("data-parent-id", panelId);

  // Panel policies are mutually exclusive. A rotated/absolute Fabric clipPath is projected for its child and blocks escape atomically.
  await panel.getByRole("button").focus(); await page.keyboard.press("Enter");
  await page.getByLabel("自动扩展").uncheck(); await page.getByLabel("裁剪内容").check();
  await expect(page.getByLabel("自动扩展")).toBeDisabled();
  await expect(firstSticky).toHaveAttribute("data-clip-parent-id", panelId);
  const clippedGeometry = await firstSticky.getAttribute("data-geometry");
  await dragObject(page, firstSticky, 620, 420, "reject");
  await expect(firstSticky).toHaveAttribute("data-geometry", clippedGeometry!);

  // With auto-expand enabled, the same boundary crossing retains parentId and expands the Panel.
  const panelBeforeExpand = await geometryOf(panel);
  await panel.getByRole("button").focus(); await page.keyboard.press("Enter");
  await page.getByLabel("裁剪内容").uncheck(); await page.getByLabel("自动扩展").check();
  await dragObject(page, firstSticky, 620, 320);
  const panelAfterExpand = await geometryOf(panel);
  expect(panelAfterExpand.width > panelBeforeExpand.width || panelAfterExpand.height > panelBeforeExpand.height).toBe(true);
  await expect(firstSticky).toHaveAttribute("data-parent-id", panelId);

  // A locked sibling keeps its exact zIndex while one-step layer movement swaps only one relative position.
  await panel.getByRole("button").focus(); await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "锁定", exact: true }).click();
  const lockedPanelZ = Number(await panel.getAttribute("data-z-index"));
  await secondSticky.getByRole("button").focus(); await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "置于底层" }).click();
  const orderedBeforeStep = await page.locator('[data-testid="board-a11y-mirror"] li').evaluateAll(rows => rows.map(row => ({ id: (row as HTMLElement).dataset.objectId!, z: Number((row as HTMLElement).dataset.zIndex) })).sort((a, b) => a.z - b.z));
  const secondIndex = orderedBeforeStep.findIndex(value => value.id === secondId);
  await page.getByRole("button", { name: "上移一层" }).click();
  const orderedAfterStep = await page.locator('[data-testid="board-a11y-mirror"] li').evaluateAll(rows => rows.map(row => ({ id: (row as HTMLElement).dataset.objectId!, z: Number((row as HTMLElement).dataset.zIndex) })).sort((a, b) => a.z - b.z));
  expect(orderedAfterStep.findIndex(value => value.id === secondId)).toBe(secondIndex + 1);
  expect(Number(await panel.getAttribute("data-z-index"))).toBe(lockedPanelZ);
  for (const label of ["置于顶层", "下移一层", "置于底层"]) await page.getByRole("button", { name: label }).click();
  const zBeforeReload = await page.locator('[data-testid="board-a11y-mirror"] li').evaluateAll(rows => rows.map(row => Number((row as HTMLElement).dataset.zIndex)));
  expect(new Set(zBeforeReload).size).toBe(zBeforeReload.length);

  // Explicit endpoint deletion keeps a free endpoint connector; the other attached end remains live.
  await firstSticky.getByRole("button").focus(); await page.keyboard.press("Enter");
  const firstId = (await firstSticky.getAttribute("data-object-id"))!;
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
  const connectorEndBeforeMove = await connector.getAttribute("data-connector-end");
  await firstSticky.getByRole("button").focus(); await page.keyboard.press("Enter");
  await page.getByTestId("board-delete-preserve-connectors").click();
  await expect(page.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(3);
  await expect(connector).toHaveAttribute("data-connector-from", "");
  await expect(connector).toHaveAttribute("data-connector-to", secondId);
  const peer = await page.context().newPage();
  await peer.goto(`/studio/board/${boardId}`); await expect(peer.getByText(/^已同步$/)).toBeVisible();
  await expect.poll(() => boardRows(peer)).toEqual(await boardRows(page));
  await dragObject(page, secondSticky, 90, 70);
  await expect(connector).not.toHaveAttribute("data-connector-end", connectorEndBeforeMove!);
  await expect.poll(async () => (await objectRow(peer, "connector").getAttribute("data-connector-end"))).not.toBe(connectorEndBeforeMove);

  const expectedRows = await boardRows(page);
  await expect.poll(() => boardRows(peer)).toEqual(expectedRows);

  await page.reload(); await expect(page.getByText(/^已同步$/)).toBeVisible();
  await expect(page.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(3);
  const reloadedRows = await boardRows(page);
  expect(reloadedRows).toEqual(expectedRows);
  await peer.close();
});
