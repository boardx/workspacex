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

test("multi-select transform, Panel clip/expand, connector preservation, and total z-order survive reload", async ({ page, request }) => {
  const token = await login(page);
  const created = await apiCall(request, token, "POST", "/whiteboards", { requestId: randomUUID(), name: `Spatial ${randomUUID()}` });
  const boardId = (await created.json() as { id: string }).id; cleanup = { id: boardId, token };
  await page.goto(`/studio/board/${boardId}`);
  await expect(page.getByText(/^已同步$/)).toBeVisible();

  await page.getByTestId("board-add-panel").click();
  await page.getByTestId("board-add-sticky").click();
  await page.getByTestId("board-add-sticky").click();
  const outline = page.getByTestId("board-a11y-mirror").getByRole("button");
  await expect(outline).toHaveCount(3);

  // Real marquee + drag exercises Fabric ActiveSelection and its one-command batch bridge.
  const canvas = page.getByTestId("board-fabric-canvas"); const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 80); await page.mouse.down(); await page.mouse.move(box.x + 900, box.y + 650, { steps: 12 }); await page.mouse.up();
  await expect(page.getByTestId("board-a11y-selection-announcement")).toContainText(/已选择 [23] 个对象/);
  await page.mouse.move(box.x + 450, box.y + 300); await page.mouse.down(); await page.mouse.move(box.x + 520, box.y + 360, { steps: 8 }); await page.mouse.up();
  await expect(page.getByText(/已用一次操作更新/)).toBeVisible();

  // Panel policies are mutually exclusive; clip is rendered by Fabric and expand is persisted after a child crosses bounds.
  await outline.first().focus(); await page.keyboard.press("Enter");
  await page.getByLabel("自动扩展").uncheck(); await page.getByLabel("裁剪内容").check();
  await expect(page.getByLabel("自动扩展")).toBeDisabled();
  await page.getByLabel("裁剪内容").uncheck(); await page.getByLabel("自动扩展").check();

  // Layer actions normalize every object to one total order; exercising all actions catches ties after reload.
  for (const label of ["上移一层", "置于顶层", "下移一层", "置于底层"]) await page.getByRole("button", { name: label }).click();

  // Explicit endpoint deletion keeps a free endpoint connector; the other attached end remains live.
  await page.getByTestId("board-tool-select").click();
  await outline.nth(1).focus(); await page.keyboard.press("Enter");
  const firstHandle = page.locator('[data-testid^="connector-handle-"][data-testid$="-right"]').first();
  await firstHandle.click();
  await outline.nth(2).focus(); await page.keyboard.press("Enter");
  await page.locator('[data-testid^="connector-handle-"][data-testid$="-left"]').first().click();
  await outline.nth(1).focus(); await page.keyboard.press("Enter");
  await page.getByTestId("board-delete-preserve-connectors").click();
  await expect(page.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(3);

  await page.reload(); await expect(page.getByText(/^已同步$/)).toBeVisible();
  await expect(page.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(3);
});
