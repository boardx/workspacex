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
  if (!value) throw new Error(`Missing Board library E2E fixture: ${name}`);
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
  return api.fetch(`${required("WHITEBOARD_API_URL").replace(/\/$/, "")}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
}

async function apiJson<T>(api: APIRequestContext, token: string, method: string, path: string, data?: unknown): Promise<T> {
  const response = await apiFetch(api, token, method, path, data);
  expect(response.ok(), `${method} ${path} returned ${response.status()}`).toBe(true);
  return response.json() as Promise<T>;
}

type Board = { id: string; name: string; archived: boolean; lifecycleRevision: number; tagIds: string[]; tagsRevision: number };
type Tag = { id: string; name: string; revision: number };

const cleanupBoards = new Set<string>();
const cleanupTags = new Map<string, number>();
let cleanupToken = "";

test.afterEach(async () => {
  if (!cleanupToken) return;
  const api = await playwrightRequest.newContext();
  const failures: string[] = [];
  try {
    for (const id of cleanupBoards) {
      const current = await apiFetch(api, cleanupToken, "GET", `/whiteboards/${id}`);
      if (current.status() === 404) continue;
      if (!current.ok()) { failures.push(`GET /whiteboards/${id}: ${current.status()} ${await current.text()}`); continue; }
      let board = await current.json() as Board;
      if (!board.archived) {
        const archived = await apiFetch(api, cleanupToken, "PATCH", `/whiteboards/${id}`, { archived: true, expectedLifecycleRevision: board.lifecycleRevision });
        if (!archived.ok()) { failures.push(`PATCH /whiteboards/${id}: ${archived.status()} ${await archived.text()}`); continue; }
        board = await archived.json() as Board;
      }
      const deleted = await apiFetch(api, cleanupToken, "DELETE", `/whiteboards/${id}`, { requestId: randomUUID(), confirmation: "PERMANENTLY_DELETE", expectedLifecycleRevision: board.lifecycleRevision });
      if (!deleted.ok()) failures.push(`DELETE /whiteboards/${id}: ${deleted.status()} ${await deleted.text()}`);
    }
    for (const [id, revision] of cleanupTags) {
      const deleted = await apiFetch(api, cleanupToken, "DELETE", `/whiteboard-tags/${id}`, { requestId: randomUUID(), expectedRevision: revision });
      if (!deleted.ok()) failures.push(`DELETE /whiteboard-tags/${id}: ${deleted.status()} ${await deleted.text()}`);
    }
  } finally {
    cleanupBoards.clear(); cleanupTags.clear(); cleanupToken = "";
    await api.dispose();
  }
  expect(failures, `cleanup failures:\n${failures.join("\n")}`).toEqual([]);
});

test("production Board library manages, duplicates, filters and deletes durable Boards", async ({ page, request: api }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const token = cleanupToken = await login(page);
  const suffix = randomUUID().slice(0, 8);
  const alpha = await apiJson<Tag>(api, token, "POST", "/whiteboard-tags", { requestId: randomUUID(), name: `Alpha-${suffix}` });
  const beta = await apiJson<Tag>(api, token, "POST", "/whiteboard-tags", { requestId: randomUUID(), name: `Beta-${suffix}` });
  cleanupTags.set(alpha.id, alpha.revision); cleanupTags.set(beta.id, beta.revision);

  const source = await apiJson<Board>(api, token, "POST", "/whiteboards", { requestId: randomUUID(), name: `Source-${suffix}` });
  const oneTag = await apiJson<Board>(api, token, "POST", "/whiteboards", { requestId: randomUUID(), name: `OneTag-${suffix}` });
  const staleDelete = await apiJson<Board>(api, token, "POST", "/whiteboards", { requestId: randomUUID(), name: `StaleDelete-${suffix}` });
  cleanupBoards.add(source.id); cleanupBoards.add(oneTag.id); cleanupBoards.add(staleDelete.id);
  const archivedOnce = await apiJson<Board>(api, token, "PATCH", `/whiteboards/${staleDelete.id}`, { archived: true, expectedLifecycleRevision: staleDelete.lifecycleRevision });
  const restored = await apiJson<Board>(api, token, "PATCH", `/whiteboards/${staleDelete.id}`, { archived: false, expectedLifecycleRevision: archivedOnce.lifecycleRevision });
  await apiJson<Board>(api, token, "PATCH", `/whiteboards/${staleDelete.id}`, { archived: true, expectedLifecycleRevision: restored.lifecycleRevision });
  expect((await apiFetch(api, token, "DELETE", `/whiteboards/${staleDelete.id}`, { requestId: randomUUID(), confirmation: "PERMANENTLY_DELETE", expectedLifecycleRevision: archivedOnce.lifecycleRevision })).status()).toBe(409);
  await apiJson<Board>(api, token, "PATCH", `/whiteboards/${source.id}`, { tagIds: [alpha.id, beta.id], expectedTagsRevision: source.tagsRevision });
  await apiJson<Board>(api, token, "PATCH", `/whiteboards/${oneTag.id}`, { tagIds: [alpha.id], expectedTagsRevision: oneTag.tagsRevision });

  await page.goto(`/studio/board/${source.id}`);
  await expect(page.getByText(/^已同步$/)).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("board-add-sticky").click();
  await expect(page.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(1);
  await expect(page.getByText(/^已同步$/)).toBeVisible({ timeout: 30_000 });

  const retryId = randomUUID(), retryPayload = { requestId: retryId, targetName: `RetryCopy-${suffix}` };
  const firstRetry = await apiJson<{ board: Board; receipt: { requestId: string; objectCount: number } }>(api, token, "POST", `/whiteboards/${source.id}/duplicates`, retryPayload);
  const secondRetry = await apiJson<{ board: Board; receipt: { requestId: string; objectCount: number } }>(api, token, "POST", `/whiteboards/${source.id}/duplicates`, retryPayload);
  cleanupBoards.add(firstRetry.board.id);
  expect(secondRetry.board.id).toBe(firstRetry.board.id);
  expect(secondRetry.receipt).toEqual(firstRetry.receipt);
  expect(firstRetry.receipt.objectCount).toBe(1);
  expect((await apiFetch(api, token, "POST", `/whiteboards/${source.id}/duplicates`, { ...retryPayload, targetName: `Conflict-${suffix}` })).status()).toBe(409);

  await page.goto("/studio/board");
  await expect(page.getByTestId(`board-card-${source.id}`)).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("board-search").fill(`Source-${suffix}`);
  await expect(page.getByTestId(`board-card-${source.id}`)).toBeVisible();
  await expect(page.getByTestId(`board-card-${oneTag.id}`)).toHaveCount(0);
  await page.getByTestId("board-search").fill("");
  await page.getByTestId(`board-filter-tag-${alpha.id}`).click();
  await page.getByTestId(`board-filter-tag-${beta.id}`).click();
  await expect(page.getByTestId(`board-card-${source.id}`)).toBeVisible();
  await expect(page.getByTestId(`board-card-${oneTag.id}`)).toHaveCount(0);
  await expect(page.getByTestId(`board-thumbnail-empty-${source.id}`)).toHaveText("暂无缩略图");

  await page.getByTestId(`board-menu-${source.id}`).click();
  await page.getByTestId(`board-action-duplicate-${source.id}`).click();
  const duplicateName = `Copy-${suffix}`;
  await page.getByTestId("board-dialog-name").fill(duplicateName);
  await page.getByTestId("board-dialog-confirm").click();
  await expect(page.getByRole("status")).toContainText("副本已创建");
  const copies = await apiJson<{ items: Board[] }>(api, token, "GET", `/whiteboards?archived=active&limit=30&query=${encodeURIComponent(duplicateName)}`);
  expect(copies.items).toHaveLength(1);
  const copy = copies.items[0]!;
  cleanupBoards.add(copy.id);

  await page.goto(`/studio/board/${copy.id}`);
  await expect(page.getByText(/^已同步$/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(1);
  await page.goto(`/studio/board/${source.id}`);
  await expect(page.getByText(/^已同步$/)).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("board-add-sticky").click();
  await expect(page.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(2);
  await page.goto(`/studio/board/${copy.id}`);
  await expect(page.getByText(/^已同步$/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(1);

  await page.goto("/studio/board");
  await page.getByTestId("board-search").fill(duplicateName);
  await expect(page.getByTestId(`board-card-${copy.id}`)).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(`board-menu-${copy.id}`).click();
  await page.getByTestId(`board-action-archive-${copy.id}`).click();
  await expect(page.getByRole("status")).toContainText("白板已归档");
  await page.getByTestId("board-filter-archived").click();
  await expect(page.getByTestId(`board-card-${copy.id}`)).toBeVisible();
  await page.getByTestId(`board-menu-${copy.id}`).click();
  await page.getByTestId(`board-action-restore-${copy.id}`).click();
  await page.getByTestId("board-filter-active").click();
  await expect(page.getByTestId(`board-card-${copy.id}`)).toBeVisible();
  await page.getByTestId(`board-menu-${copy.id}`).click();
  await page.getByTestId(`board-action-archive-${copy.id}`).click();
  await page.getByTestId("board-filter-archived").click();
  await expect(page.getByTestId(`board-card-${copy.id}`)).toBeVisible();
  await page.getByTestId(`board-menu-${copy.id}`).click();
  await page.getByTestId(`board-action-delete-${copy.id}`).click();
  await page.getByTestId("board-dialog-confirm").click();
  await expect(page.getByRole("status")).toContainText("白板已永久删除");
  expect((await apiFetch(api, token, "GET", `/whiteboards/${copy.id}`)).status()).toBe(404);
  cleanupBoards.delete(copy.id);
});
