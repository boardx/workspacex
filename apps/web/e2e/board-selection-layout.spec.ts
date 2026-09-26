import { randomUUID } from "node:crypto";
import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { SESSION_TOKEN_STORAGE_KEY } from "../lib/api-client";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

test.describe.configure({ mode: "serial", timeout: 120_000 });

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

let cleanup: { id: string; token: string } | undefined;
test.afterEach(async () => {
  if (!cleanup) return;
  const api = await playwrightRequest.newContext();
  try { await apiRequest(api, cleanup.token, "PATCH", `/whiteboards/${cleanup.id}`, { archived: true }); }
  finally { await api.dispose(); cleanup = undefined; }
});

test("multi-select layout toolbar persists one grid operation", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const token = await login(page);
  const created = await apiRequest(request, token, "POST", "/whiteboards", { requestId: randomUUID(), name: `Selection layout ${randomUUID()}` });
  const boardId = (await created.json() as { id: string }).id;
  cleanup = { id: boardId, token };
  await page.goto(`/studio/board/${boardId}`);
  await expect(page.getByText(/^已同步$/)).toBeVisible({ timeout: 30_000 });

  await page.keyboard.press("Shift+N");
  await page.getByTestId("board-bulk-text").fill("一\n二\n三\n四\n五\n六");
  await page.getByTestId("board-bulk-apply").click();
  await expect(page.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(6);

  const canvas = page.getByTestId("board-fabric-canvas");
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + 560, bounds!.y + 330);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 1420, bounds!.y + 820, { steps: 12 });
  await page.mouse.up();

  const toolbar = page.getByTestId("board-selection-layout-toolbar");
  await expect(toolbar).toBeVisible();
  await expect(page.getByTestId("board-layout-align-left")).toBeEnabled();
  await expect(page.getByTestId("board-layout-distribute-horizontal")).toBeEnabled();
  await page.getByTestId("board-layout-gap").fill("24");
  await page.getByTestId("board-layout-columns").fill("3");
  await page.getByTestId("board-layout-grid").click();
  await expect(page.getByText("已整理 6 个对象。")).toBeVisible();

  await page.reload();
  await expect(page.getByText(/^已同步$/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(6);
});
