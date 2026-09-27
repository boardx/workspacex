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
  const settleCanvas = () => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const scanInteractiveCanvas = async () => page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="board-fabric-surface"] canvas[data-fabric="top"]');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect(), inset = 8, step = 12;
    const points: Array<{ x: number; y: number }> = [];
    for (let y = rect.top + inset; y <= rect.bottom - inset; y += step) {
      for (let x = rect.left + inset; x <= rect.right - inset; x += step) {
        if (document.elementFromPoint(x, y) === canvas) points.push({ x, y });
      }
    }
    if (!points.length) return null;
    const topLeft = points.reduce((best, point) => point.x + point.y < best.x + best.y ? point : best);
    const bottomRight = points.reduce((best, point) => point.x + point.y > best.x + best.y ? point : best);
    const bottomLeft = points.reduce((best, point) => point.y - point.x > best.y - best.x ? point : best);
    return { rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, topLeft, bottomRight, bottomLeft, count: points.length };
  });

  await selectTool.click();
  await expect(selectTool).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("board-zoom-fit-board").click();
  await settleCanvas();
  expect(parseGeometry(await geometry(page))).toHaveLength(7);

  const beforeClear = await scanInteractiveCanvas();
  expect(beforeClear?.count, "Fit Board must leave an interactive upper-canvas margin").toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await page.mouse.click(beforeClear!.bottomLeft.x, beforeClear!.bottomLeft.y);
  await expect(page.getByTestId("board-a11y-selection-announcement")).toHaveText("未选择对象");

  // Contextual UI disappears after clearing selection and can resize Fabric.
  // Scan the real post-resize upper canvas again and immediately use its
  // extreme interactive points; no world-to-screen projection is involved.
  await settleCanvas();
  const dragArea = await scanInteractiveCanvas();
  expect(dragArea?.count, "post-clear upper canvas must expose interactive points").toBeGreaterThan(0);
  expect(dragArea!.topLeft.x).toBeLessThan(dragArea!.bottomRight.x);
  expect(dragArea!.topLeft.y).toBeLessThan(dragArea!.bottomRight.y);
  expect(dragArea!.topLeft.x - dragArea!.rect.left).toBeLessThanOrEqual(32);
  expect(dragArea!.topLeft.y - dragArea!.rect.top).toBeLessThanOrEqual(220);
  expect(dragArea!.rect.right - dragArea!.bottomRight.x).toBeLessThanOrEqual(32);
  expect(dragArea!.rect.bottom - dragArea!.bottomRight.y).toBeLessThanOrEqual(32);
  const hitSurfaces = await page.evaluate(([startPoint, endPoint]) => [startPoint, endPoint].map((point) => {
    const element = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
    return { fabric: element?.dataset.fabric ?? null, insideSurface: Boolean(element?.closest('[data-testid="board-fabric-surface"]')) };
  }), [dragArea!.topLeft, dragArea!.bottomRight] as const);
  expect(hitSurfaces).toEqual([{ fabric: "top", insideSurface: true }, { fabric: "top", insideSurface: true }]);
  await page.mouse.move(dragArea!.topLeft.x, dragArea!.topLeft.y);
  await page.mouse.down();
  await page.mouse.move(dragArea!.bottomRight.x, dragArea!.bottomRight.y, { steps: 16 });
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
    const textEditor = page.getByLabel("对象文字", { exact: true });
    await expect(textEditor).toBeVisible();
    await textEditor.fill("研究标题");
    await textEditor.press("Escape");
    await expect(page.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(7);
    await expect(page.getByTestId("board-a11y-mirror").getByRole("button", { name: "图形：研究标题" })).toBeVisible();

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
