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

let boardToArchive: { id: string; token: string } | undefined;

test.afterEach(async () => {
  const target = boardToArchive;
  boardToArchive = undefined;
  if (!target) return;

  // The browser context is deliberately not used for cleanup. A timed-out page is
  // closed before its request fixture can finish, while this API context belongs to
  // the afterEach hook and therefore retains the hook's independent timeout budget.
  const cleanupApi = await playwrightRequest.newContext();
  try {
    await apiRequest(cleanupApi, target.token, "PATCH", `/whiteboards/${target.id}`, { archived: true });
  } finally {
    await cleanupApi.dispose();
  }
});

test("fabric surface viewport", async ({ page, request: api }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const token = await login(page);
  const created = await apiRequest(api, token, "POST", "/whiteboards", { requestId: randomUUID(), name: `Fabric surface ${randomUUID()}` });
  const boardId = (await created.json() as { id: string }).id;
  boardToArchive = { id: boardId, token };
  await page.goto(`/studio/board/${boardId}`);
  await expect(page.getByTestId("collaborative-editor")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^已同步$/)).toBeVisible({ timeout: 30_000 });

  for (const kind of ["sticky", "text", "rectangle", "ellipse"] as const) await page.getByTestId(`board-add-${kind}`).click();

  const surface = page.getByTestId("board-fabric-surface");
  const canvas = page.getByTestId("board-fabric-canvas");
  await expect(surface).toBeVisible();
  await expect(canvas).toBeVisible();
  const bounds = await surface.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeLessThanOrEqual(1);
  expect(bounds!.y).toBeLessThanOrEqual(1);
  expect(bounds!.x + bounds!.width).toBeGreaterThanOrEqual(1279);
  expect(bounds!.y + bounds!.height).toBeGreaterThanOrEqual(799);

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
