import { randomUUID } from "node:crypto";
import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { SESSION_TOKEN_STORAGE_KEY } from "../lib/api-client";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

test.describe.configure({ mode: "serial", timeout: 180_000 });

function required(name: string): string {
  const fallbacks: Record<string, string | undefined> = {
    WHITEBOARD_OWNER_EMAIL: FULLSTACK_E2E.adminEmail,
    WHITEBOARD_OWNER_PASSWORD: FULLSTACK_E2E.adminPassword,
    WHITEBOARD_API_URL: process.env.WORKSPACEX_API_PORT ? `http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}` : undefined,
  };
  const value = process.env[name] ?? fallbacks[name];
  if (!value) throw new Error(`Missing Board visual-content E2E fixture: ${name}`);
  return value;
}

async function login(page: Page): Promise<string> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(required("WHITEBOARD_OWNER_EMAIL"));
  await page.getByTestId("login-password").fill(required("WHITEBOARD_OWNER_PASSWORD"));
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });
  const token = await page.evaluate((key) => localStorage.getItem(key), SESSION_TOKEN_STORAGE_KEY);
  expect(token).toBeTruthy();
  return token!;
}

async function apiFetch(api: APIRequestContext, token: string, method: string, path: string, data?: unknown) {
  return api.fetch(`${required("WHITEBOARD_API_URL").replace(/\/$/, "")}${path}`, { method, headers: { Authorization: `Bearer ${token}` }, data });
}

type Board = { id: string; archived: boolean; lifecycleRevision: number };
let cleanup: { boardId: string; token: string } | null = null;

test.afterEach(async () => {
  if (!cleanup) return;
  const target = cleanup; cleanup = null;
  const api = await playwrightRequest.newContext();
  try {
    const current = await apiFetch(api, target.token, "GET", `/whiteboards/${target.boardId}`);
    if (!current.ok()) return;
    let board = await current.json() as Board;
    if (!board.archived) {
      const archived = await apiFetch(api, target.token, "PATCH", `/whiteboards/${target.boardId}`, { archived: true, expectedLifecycleRevision: board.lifecycleRevision });
      expect(archived.ok()).toBe(true); board = await archived.json() as Board;
    }
    const deleted = await apiFetch(api, target.token, "DELETE", `/whiteboards/${target.boardId}`, { requestId: randomUUID(), confirmation: "PERMANENTLY_DELETE", expectedLifecycleRevision: board.lifecycleRevision });
    expect(deleted.ok()).toBe(true);
  } finally { await api.dispose(); }
});

test("Shape Draw Image and Tile share one canonical collaborative surface", async ({ page, request: api, context }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const token = await login(page);
  const created = await apiFetch(api, token, "POST", "/whiteboards", { requestId: randomUUID(), name: `Visual content ${randomUUID()}` });
  expect(created.ok()).toBe(true);
  const board = await created.json() as Board;
  cleanup = { boardId: board.id, token };
  await page.goto(`/studio/board/${board.id}`);
  await expect(page.getByText(/^已同步$/)).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("board-add-shape").click();
  await page.getByTestId("board-add-more").click();
  await page.getByTestId("board-content-tile").click();

  const canvas = page.getByTestId("board-fabric-canvas");
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  await page.getByTestId("board-add-draw").click();
  await page.mouse.move(bounds!.x + 360, bounds!.y + 280);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 500, bounds!.y + 360, { steps: 12 });
  await page.mouse.up();

  // Let Chromium encode the fixture so the test exercises a genuinely decodable PNG
  // instead of relying on a hand-copied base64 payload with uncertain chunk CRCs.
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: 32, height: 32 } });
  await page.getByTestId("board-image-input").setInputFiles({ name: "research.png", mimeType: "image/png", buffer: png });

  const outline = page.getByTestId("board-a11y-mirror").getByRole("button");
  await expect(outline).toHaveCount(4);
  await expect(page.getByText(/^已同步$/)).toBeVisible({ timeout: 30_000 });

  const peer = await context.newPage();
  await peer.goto(`/studio/board/${board.id}`);
  await expect(peer.getByText(/^已同步$/)).toBeVisible({ timeout: 30_000 });
  await expect(peer.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(4);

  await page.getByRole("button", { name: "撤销" }).click();
  await expect(page.getByText("已撤销本地修改", { exact: true })).toBeVisible();
  await expect(outline).toHaveCount(3);
  await expect(peer.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(3);
  await page.getByRole("button", { name: "重做" }).click();
  await expect(outline).toHaveCount(4);
  await expect(peer.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(4);
  await peer.close();

  await page.reload();
  await expect(page.getByText(/^已同步$/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "图形：research.png" })).toHaveAttribute("aria-description", /图片需在当前会话重新验证/);
});
