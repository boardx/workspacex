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
  return page.getByTestId("board-a11y-mirror").locator("li[data-object-id]").evaluateAll((items) => JSON.stringify(items.map((item) => ({
    id: item.getAttribute("data-object-id"), x: Number(item.getAttribute("data-x")), y: Number(item.getAttribute("data-y")),
    width: Number(item.getAttribute("data-width")), height: Number(item.getAttribute("data-height")), rotation: Number(item.getAttribute("data-rotation")),
  })).sort((a, b) => String(a.id).localeCompare(String(b.id)))));
}

type Geometry = { id: string | null; x: number; y: number; width: number; height: number; rotation: number };
function layoutSemantics(kind: string, serialized: string): boolean {
  const values = JSON.parse(serialized) as Geometry[], epsilon = 1;
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
  if (["grid", "tidy-up"].includes(kind)) return new Set(values.map(value => Math.round(value.y))).size === Math.ceil(values.length / 3);
  return false;
}

async function marqueeAll(page: Page): Promise<void> {
  while ((Number((await page.getByTestId("board-zoom-value").textContent())?.replace("%", "")) || 100) > 70) {
    await page.getByTestId("board-zoom-out").click();
  }
  const bounds = await page.getByTestId("board-fabric-canvas").boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + 300, bounds!.y + 200);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width - 20, bounds!.y + bounds!.height - 20, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByTestId("board-a11y-selection-announcement")).toHaveText("已选择 7 个对象");
  await expect(page.getByTestId("board-selection-layout-toolbar")).toBeVisible();
}

let cleanup: { id: string; token: string } | undefined;
test.afterEach(async () => {
  if (!cleanup) return;
  const api = await playwrightRequest.newContext();
  try { await apiRequest(api, cleanup.token, "PATCH", `/whiteboards/${cleanup.id}`, { archived: true }); }
  finally { await api.dispose(); cleanup = undefined; }
});

test("all 15 canonical layouts satisfy geometry semantics, persist to a second client and undo as one operation", async ({ page, request, browser, baseURL }) => {
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
      expect(layoutSemantics(operation, arranged), `${operation} must satisfy its geometry semantics`).toBe(true);
      await expect.poll(() => geometry(second)).toBe(arranged);

      await page.getByText("撤销", { exact: true }).click();
      await expect.poll(() => geometry(page)).toBe(original);
      await expect.poll(() => geometry(second)).toBe(original);
    }

    await marqueeAll(page);
    await page.getByTestId("board-layout-smart-preview").click();
    await expect(page.getByTestId("board-layout-preview")).toBeVisible();
    await expect.poll(() => geometry(page)).not.toBe(original);
    await expect.poll(() => geometry(second)).toBe(original);
    await page.getByTestId("board-layout-preview-cancel").click();
    await expect.poll(() => geometry(page)).toBe(original);

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
