import { randomUUID } from "node:crypto";
import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { SESSION_TOKEN_STORAGE_KEY } from "../lib/api-client";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

test.describe.configure({ mode: "serial", timeout: 180_000 });

function required(name: string): string {
  const fallback: Record<string, string | undefined> = {
    WHITEBOARD_OWNER_EMAIL: FULLSTACK_E2E.adminEmail,
    WHITEBOARD_OWNER_PASSWORD: FULLSTACK_E2E.adminPassword,
    WHITEBOARD_API_URL: process.env.WORKSPACEX_API_PORT ? `http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}` : undefined,
  };
  const value = process.env[name] ?? fallback[name];
  if (!value) throw new Error(`Missing Board layout E2E fixture: ${name}`);
  return value;
}

async function login(page: Page): Promise<string> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(required("WHITEBOARD_OWNER_EMAIL"));
  await page.getByTestId("login-password").fill(required("WHITEBOARD_OWNER_PASSWORD"));
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });
  return (await page.evaluate((key) => localStorage.getItem(key), SESSION_TOKEN_STORAGE_KEY))!;
}

async function apiRequest(api: APIRequestContext, token: string, method: string, path: string, data?: unknown) {
  const response = await api.fetch(`${required("WHITEBOARD_API_URL").replace(/\/$/, "")}${path}`, { method, headers: { Authorization: `Bearer ${token}` }, data });
  expect(response.ok(), `${method} ${path} returned ${response.status()}`).toBe(true);
  return response;
}

async function geometry(page: Page): Promise<string> {
  return page.getByTestId("board-a11y-mirror").locator("li[data-object-id]").evaluateAll((items) => JSON.stringify(items.map((item, order) => ({
    id: item.getAttribute("data-object-id"), x: Number(item.getAttribute("data-x")), y: Number(item.getAttribute("data-y")),
    width: Number(item.getAttribute("data-width")), height: Number(item.getAttribute("data-height")), rotation: Number(item.getAttribute("data-rotation")), order,
  })).sort((a, b) => String(a.id).localeCompare(String(b.id)))));
}

type Geometry = { id: string | null; x: number; y: number; width: number; height: number; rotation: number; order: number };
function parseGeometry(serialized: string): Geometry[] { return JSON.parse(serialized) as Geometry[]; }

function gridSemantics(values: Geometry[], original: Geometry[], preserveOrder: "selection" | "visual"): boolean {
  const epsilon = 1;
  const rows: Geometry[][] = [];
  for (const value of [...values].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find(candidate => Math.abs(candidate[0]!.y - value.y) <= epsilon);
    if (row) row.push(value); else rows.push([value]);
  }
  rows.forEach(row => row.sort((a, b) => a.x - b.x));
  if (rows.length !== Math.ceil(values.length / 3) || rows.some((row, index) => row.length !== Math.min(3, values.length - index * 3))) return false;
  const columnWidths = [0, 1, 2].map(column => Math.max(...rows.flatMap(row => row[column] ? [row[column]!.width] : [])));
  const rowHeights = rows.map(row => Math.max(...row.map(value => value.height)));
  for (const row of rows) {
    for (let column = 1; column < row.length; column += 1) {
      if (Math.abs(row[column]!.x - row[column - 1]!.x - columnWidths[column - 1]! - 24) > epsilon) return false;
    }
  }
  for (let row = 1; row < rows.length; row += 1) {
    if (Math.abs(rows[row]![0]!.y - rows[row - 1]![0]!.y - rowHeights[row - 1]! - 24) > epsilon) return false;
  }
  const expected = preserveOrder === "visual"
    ? [...original].sort((a, b) => a.y - b.y || a.x - b.x || String(a.id).localeCompare(String(b.id))).map(value => value.id)
    : [...original].sort((a, b) => a.order - b.order).map(value => value.id);
  const actual = rows.flat().map(value => value.id);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) return false;
  return true;
}

function layoutSemantics(kind: string, serialized: string, originalSerialized: string): boolean {
  const values = JSON.parse(serialized) as Geometry[], epsilon = 1;
  const original = parseGeometry(originalSerialized);
  const close = (items: number[]) => Math.max(...items) - Math.min(...items) <= epsilon;
  if (kind === "align-left") return close(values.map(value => value.x));
  if (kind === "align-center") return close(values.map(value => value.x + value.width / 2));
  if (kind === "align-right") return close(values.map(value => value.x + value.width));
  if (kind === "align-top") return close(values.map(value => value.y));
  if (kind === "align-middle") return close(values.map(value => value.y + value.height / 2));
  if (kind === "align-bottom") return close(values.map(value => value.y + value.height));
  if (kind === "equal-width") return close(values.map(value => value.width));
  if (kind === "equal-height") return close(values.map(value => value.height));
  if (kind === "equal-size") return close(values.map(value => value.width)) && close(values.map(value => value.height));
  const horizontal = [...values].sort((a, b) => a.x - b.x), vertical = [...values].sort((a, b) => a.y - b.y);
  if (kind === "distribute-horizontal") return close(horizontal.slice(1).map((value, index) => value.x - (horizontal[index]!.x + horizontal[index]!.width)));
  if (kind === "distribute-vertical") return close(vertical.slice(1).map((value, index) => value.y - (vertical[index]!.y + vertical[index]!.height)));
  if (kind === "row") return close(values.map(value => value.y)) && horizontal.slice(1).every((value, index) => Math.abs(value.x - (horizontal[index]!.x + horizontal[index]!.width) - 24) <= epsilon);
  if (kind === "column") return close(values.map(value => value.x)) && vertical.slice(1).every((value, index) => Math.abs(value.y - (vertical[index]!.y + vertical[index]!.height) - 24) <= epsilon);
  if (kind === "grid") return gridSemantics(values, original, "selection");
  if (kind === "tidy-up") return gridSemantics(values, original, "visual");
  return false;
}

function closeGeometry(left: Geometry, right: Geometry, epsilon = 1): boolean {
  return Math.abs(left.x - right.x) <= epsilon && Math.abs(left.y - right.y) <= epsilon
    && Math.abs(left.width - right.width) <= epsilon && Math.abs(left.height - right.height) <= epsilon
    && Math.abs(left.rotation - right.rotation) <= epsilon;
}

async function marqueeAll(page: Page): Promise<void> {
  const selectTool = page.getByTestId("board-tool-select");
  await selectTool.click();
  await expect(selectTool).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("board-zoom-fit-board").click();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const objects = parseGeometry(await geometry(page));
  expect(objects).toHaveLength(7);
  const surface = page.getByTestId("board-fabric-surface");
  const upperCanvas = surface.locator('canvas[data-fabric="top"]');
  const box = await upperCanvas.boundingBox();
  expect(box).not.toBeNull();
  const zoom = Number(await surface.getAttribute("data-viewport-zoom"));
  const panX = Number(await surface.getAttribute("data-viewport-pan-x"));
  const panY = Number(await surface.getAttribute("data-viewport-pan-y"));
  expect(Number.isFinite(zoom) && zoom > 0).toBe(true);
  const corners = objects.flatMap(({ x, y, width, height, rotation }) => {
    const radians = rotation * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians);
    return [[0, 0], [width, 0], [width, height], [0, height]].map(([localX, localY]) => ({
      x: x + localX! * cosine - localY! * sine,
      y: y + localX! * sine + localY! * cosine,
    }));
  });
  const margin = 28 / zoom;
  const toScreen = (x: number, y: number) => ({ x: box!.x + panX + x * zoom, y: box!.y + panY + y * zoom });
  const screenCorners = corners.map(point => toScreen(point.x, point.y));
  const objectScreenBounds = {
    left: Math.min(...screenCorners.map(point => point.x)), top: Math.min(...screenCorners.map(point => point.y)),
    right: Math.max(...screenCorners.map(point => point.x)), bottom: Math.max(...screenCorners.map(point => point.y)),
  };
  const inset = 8;
  const desiredStart = toScreen(Math.min(...corners.map(point => point.x)) - margin, Math.min(...corners.map(point => point.y)) - margin);
  const desiredEnd = toScreen(Math.max(...corners.map(point => point.x)) + margin, Math.max(...corners.map(point => point.y)) + margin);
  const start = { x: Math.max(box!.x + inset, desiredStart.x), y: Math.max(box!.y + inset, desiredStart.y) };
  const end = { x: Math.min(box!.x + box!.width - inset, desiredEnd.x), y: Math.min(box!.y + box!.height - inset, desiredEnd.y) };
  expect(start.x).toBeLessThan(objectScreenBounds.left - 2);
  expect(start.y).toBeLessThan(objectScreenBounds.top - 2);
  expect(end.x).toBeGreaterThan(objectScreenBounds.right + 2);
  expect(end.y).toBeGreaterThan(objectScreenBounds.bottom + 2);
  const clearPoint = await page.evaluate(({ canvasTestId, bounds }) => {
    const canvas = document.querySelector<HTMLElement>(`[data-testid="${canvasTestId}"] canvas[data-fabric="top"]`);
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    for (let y = rect.bottom - 16; y >= rect.top + 16; y -= 24) for (let x = rect.left + 16; x <= rect.right - 16; x += 24) {
      const outsideObjects = x < bounds.left - 4 || x > bounds.right + 4 || y < bounds.top - 4 || y > bounds.bottom + 4;
      if (outsideObjects && document.elementFromPoint(x, y) === canvas) return { x, y };
    }
    return null;
  }, { canvasTestId: "board-fabric-surface", bounds: objectScreenBounds });
  expect(clearPoint, "an interactive blank upper-canvas point must exist to clear selection").not.toBeNull();
  await page.keyboard.press("Escape");
  await page.mouse.click(clearPoint!.x, clearPoint!.y);
  await expect(page.getByTestId("board-a11y-selection-announcement")).toHaveText("未选择对象");
  const hitSurfaces = await page.evaluate(([startPoint, endPoint]) => [startPoint, endPoint].map((point) => {
    const element = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
    return { fabric: element?.dataset.fabric ?? null, insideSurface: Boolean(element?.closest('[data-testid="board-fabric-surface"]')) };
  }), [start, end] as const);
  expect(hitSurfaces).toEqual([{ fabric: "top", insideSurface: true }, { fabric: "top", insideSurface: true }]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByTestId("board-a11y-selection-announcement")).toHaveText("已选择 7 个对象");
  await expect(page.getByTestId("board-selection-layout-toolbar")).toBeVisible();
}

let cleanup: { id: string; token: string } | undefined;
test.afterEach(async () => {
  if (!cleanup) return;
  const target = cleanup; cleanup = undefined;
  const api = await playwrightRequest.newContext();
  try {
    const current = await apiRequest(api, target.token, "GET", `/whiteboards/${target.id}`);
    const board = await current.json() as { archived: boolean; lifecycleRevision: number };
    if (!board.archived) await apiRequest(api, target.token, "PATCH", `/whiteboards/${target.id}`, { archived: true, expectedLifecycleRevision: board.lifecycleRevision });
  } finally { await api.dispose(); }
});

test.describe("organize <=2 actions", () => {
test.describe("snap guideline zoom", () => {
test("smart layout confirm cancel", async ({ page, request, browser, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const token = await login(page);
  const created = await apiRequest(request, token, "POST", "/whiteboards", { requestId: randomUUID(), name: `Selection layout ${randomUUID()}` });
  const boardId = (await created.json() as { id: string }).id;
  cleanup = { id: boardId, token };
  const secondContext = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  const second = await secondContext.newPage();
  try {
    await page.goto(`/studio/board/${boardId}`);
    await expect(page.getByText(/^已同步$/)).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("Shift+N");
    await page.getByTestId("board-bulk-text").fill("一\n二\n三\n四\n五\n六");
    await page.getByTestId("board-bulk-apply").click();
    await expect(page.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(6);
    await page.keyboard.press("t");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(7);

    await login(second);
    await second.goto(`/studio/board/${boardId}`);
    await expect(second.getByText(/^已同步$/)).toBeVisible({ timeout: 30_000 });
    await expect(second.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(7);
    const original = await geometry(page);
    await expect.poll(() => geometry(second)).toBe(original);

    const operations = ["align-left", "align-center", "align-right", "align-top", "align-middle", "align-bottom", "distribute-horizontal", "distribute-vertical", "equal-width", "equal-height", "equal-size", "grid", "row", "column", "tidy-up"] as const;
    for (const operation of operations) {
      await marqueeAll(page);
      await page.getByTestId("board-layout-gap").fill("24");
      await page.getByTestId("board-layout-columns").fill("3");
      await page.getByTestId(`board-layout-${operation}`).click();
      await expect.poll(async () => (await geometry(page)) !== original).toBe(true);
      const arranged = await geometry(page);
      expect(layoutSemantics(operation, arranged, original), `${operation} must satisfy its geometry semantics`).toBe(true);
      await expect.poll(() => geometry(second)).toBe(arranged);

      await page.getByText("撤销", { exact: true }).click();
      await expect.poll(() => geometry(page)).toBe(original);
      await expect.poll(() => geometry(second)).toBe(original);
    }

    // A real Fabric ActiveSelection drag writes every child as one canonical batch and one undo unit.
    await marqueeAll(page);
    const beforeGroupDrag = parseGeometry(await geometry(page));
    const canvasBounds = await page.getByTestId("board-fabric-canvas").boundingBox();
    expect(canvasBounds).not.toBeNull();
    const zoom = Number((await page.getByTestId("board-zoom-value").textContent())?.replace("%", "")) / 100;
    const groupLeft = Math.min(...beforeGroupDrag.map(value => value.x));
    const groupTop = Math.min(...beforeGroupDrag.map(value => value.y));
    const groupRight = Math.max(...beforeGroupDrag.map(value => value.x + value.width));
    const groupBottom = Math.max(...beforeGroupDrag.map(value => value.y + value.height));
    const groupStart = { x: canvasBounds!.x + (groupLeft + groupRight) / 2 * zoom, y: canvasBounds!.y + (groupTop + groupBottom) / 2 * zoom };
    await page.keyboard.down("Alt");
    await page.mouse.move(groupStart.x, groupStart.y); await page.mouse.down();
    await page.mouse.move(groupStart.x + 42, groupStart.y + 28, { steps: 8 }); await page.mouse.up();
    await page.keyboard.up("Alt");
    const afterGroupDrag = parseGeometry(await geometry(page));
    const deltas = afterGroupDrag.map(value => {
      const before = beforeGroupDrag.find(candidate => candidate.id === value.id)!;
      return { x: value.x - before.x, y: value.y - before.y };
    });
    expect(deltas.every(delta => Math.abs(delta.x - deltas[0]!.x) <= 1 && Math.abs(delta.y - deltas[0]!.y) <= 1 && Math.abs(delta.x) > 1)).toBe(true);
    await expect.poll(() => geometry(second)).toBe(JSON.stringify(afterGroupDrag.sort((a, b) => String(a.id).localeCompare(String(b.id)))));
    await page.getByText("撤销", { exact: true }).click();
    await expect.poll(() => geometry(page)).toBe(original);
    await expect.poll(() => geometry(second)).toBe(original);

    // A real Fabric pointer drag exposes a smart guide and persists the snapped world-space position.
    const snapBefore = parseGeometry(original);
    const source = snapBefore[0]!, target = snapBefore[1]!;
    await page.getByTestId(`board-a11y-object-${source.id}`).click();
    const sourceCenter = { x: canvasBounds!.x + (source.x + source.width / 2) * zoom, y: canvasBounds!.y + (source.y + source.height / 2) * zoom };
    await page.mouse.move(sourceCenter.x, sourceCenter.y); await page.mouse.down();
    await page.mouse.move(sourceCenter.x + 56, canvasBounds!.y + (target.y + source.height / 2 + 3) * zoom, { steps: 12 });
    await expect(page.getByTestId("board-smart-guides")).toBeVisible();
    await page.mouse.up();
    const snapAfter = parseGeometry(await geometry(page));
    const snappedSource = snapAfter.find(value => value.id === source.id)!;
    expect(Math.abs(snappedSource.y - target.y)).toBeLessThanOrEqual(1);
    expect(closeGeometry(snappedSource, source)).toBe(false);
    await expect.poll(() => geometry(second)).toBe(JSON.stringify(snapAfter.sort((a, b) => String(a.id).localeCompare(String(b.id)))));
    await page.getByText("撤销", { exact: true }).click();
    await expect.poll(() => geometry(page)).toBe(original);
    await expect.poll(() => geometry(second)).toBe(original);

    await marqueeAll(page);
    await page.getByTestId("board-layout-smart-preview").click();
    await expect(page.getByTestId("board-layout-preview")).toBeVisible();
    await expect.poll(() => geometry(page)).not.toBe(original);
    await expect.poll(() => geometry(second)).toBe(original);
    await page.getByTestId("board-layout-preview-cancel").click();
    await expect.poll(() => geometry(page)).toBe(original);

    await page.getByTestId("board-layout-smart-preview").click();
    const confirmedPreview = await geometry(page);
    expect(confirmedPreview).not.toBe(original);
    await page.getByTestId("board-layout-preview-apply").click();
    await expect(page.getByText("智能布局已应用。", { exact: true })).toBeVisible();
    await expect.poll(() => geometry(page)).toBe(confirmedPreview);
    await expect.poll(() => geometry(second)).toBe(confirmedPreview);
    await page.getByText("撤销", { exact: true }).click();
    await expect.poll(() => geometry(page)).toBe(original);
    await expect.poll(() => geometry(second)).toBe(original);

    await page.getByTestId("board-layout-smart-preview").click();
    const remoteObject = second.getByTestId("board-a11y-mirror").getByRole("button").first();
    await remoteObject.focus(); await remoteObject.press("Enter");
    await second.getByLabel("对象文字", { exact: true }).fill("并发修改后的对象");
    await page.getByTestId("board-layout-preview-apply").click();
    await expect(page.getByText("应用失败：预览后对象已被其他协作者修改。", { exact: true })).toBeVisible();
    await expect.poll(() => geometry(page)).toBe(original);

    await page.reload();
    await expect(page.getByText(/^已同步$/)).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => geometry(page)).toBe(original);
  } finally {
    await secondContext.close();
  }
});
});
});
