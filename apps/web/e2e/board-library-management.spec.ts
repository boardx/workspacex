import {BOARD_SYNCED_STATUS} from "./support/board-sync-status";
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
  await expect(page.getByText(BOARD_SYNCED_STATUS)).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("board-add-sticky").click();
  await expect(page.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(1);
  await expect(page.getByText(BOARD_SYNCED_STATUS)).toBeVisible({ timeout: 30_000 });

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
  await expect(page.getByTestId(`board-thumbnail-empty-${source.id}`)).toHaveText("预览尚未生成");

  await page.getByTestId(`board-menu-${source.id}`).click();
  await page.getByTestId(`board-action-duplicate-${source.id}`).click();
  const duplicateName = `Copy-${suffix}`;
  await page.getByTestId("board-dialog-name").fill(duplicateName);
  await page.getByTestId("board-dialog-confirm").click();
  await expect(page.getByText("副本已创建。", { exact: true })).toBeVisible();
  const copies = await apiJson<{ items: Board[] }>(api, token, "GET", `/whiteboards?archived=active&limit=30&query=${encodeURIComponent(duplicateName)}`);
  const exactCopies = copies.items.filter((board) => board.name === duplicateName);
  expect(exactCopies).toHaveLength(1);
  const copy = exactCopies[0]!;
  cleanupBoards.add(copy.id);

  await page.goto(`/studio/board/${copy.id}`);
  await expect(page.getByText(BOARD_SYNCED_STATUS)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(1);
  await page.goto(`/studio/board/${source.id}`);
  await expect(page.getByText(BOARD_SYNCED_STATUS)).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("board-add-sticky").click();
  await expect(page.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(2);
  await page.goto(`/studio/board/${copy.id}`);
  await expect(page.getByText(BOARD_SYNCED_STATUS)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(1);

  await page.goto("/studio/board");
  await page.getByTestId("board-search").fill(duplicateName);
  await expect(page.getByTestId(`board-card-${copy.id}`)).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(`board-menu-${copy.id}`).click();
  await page.getByTestId(`board-action-archive-${copy.id}`).click();
  await expect(page.getByText("白板已归档。", { exact: true })).toBeVisible();
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
  await expect(page.getByText("白板已永久删除。", { exact: true })).toBeVisible();
  expect((await apiFetch(api, token, "GET", `/whiteboards/${copy.id}`)).status()).toBe(404);
  cleanupBoards.delete(copy.id);
});

test("Board navigation retains shell in library and only editor is fullscreen", async ({ page, request: api }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const token = cleanupToken = await login(page);
  const board = await apiJson<Board>(api, token, "POST", "/whiteboards", { requestId: randomUUID(), name: `Navigation-${randomUUID()}` });
  cleanupBoards.add(board.id);
  await page.getByTestId("rail-whiteboard").click();
  await expect(page).toHaveURL(/\/studio\/board$/);
  await expect(page.getByTestId("rail-whiteboard")).toBeVisible();
  await expect(page.getByTestId("rail-whiteboard")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("whiteboard-library")).toBeVisible();
  await expect(page.getByTestId(`board-card-${board.id}`)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("board-library-with-navigation.png") });
  await page.getByTestId(`board-open-${board.id}`).click();
  await expect(page).toHaveURL(new RegExp(`/studio/board/${board.id}$`));
  await expect(page.getByText(BOARD_SYNCED_STATUS)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("rail-whiteboard")).not.toBeVisible();
  await expect(async () => {
    const region = page.getByTestId("board-editor-region");
    const shell = await region.locator("..").boundingBox();
    const banner = await page.getByTestId("board-sync-banner").boundingBox();
    const bounds = await region.boundingBox();
    const editor = await page.getByTestId("collaborative-editor").boundingBox();
    expect(shell).toEqual({ x: 0, y: 0, width: 1280, height: 800 });
    expect(banner).not.toBeNull(); expect(bounds).not.toBeNull(); expect(editor).not.toBeNull();
    expect(banner!.height).toBeGreaterThan(0); expect(bounds!.height).toBeGreaterThan(0);
    expect(banner).toEqual({ x: 0, y: 0, width: 1280, height: banner!.height });
    expect(bounds).toEqual({ x: 0, y: banner!.height, width: 1280, height: 800 - banner!.height });
    expect(editor).toEqual(bounds);
  }).toPass({ timeout: 5000 });
  await page.screenshot({ path: testInfo.outputPath("board-editor-fullscreen.png") });
  await page.getByRole("button", { name: "返回白板", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/board$/);
  await expect(page.getByTestId("rail-whiteboard")).toBeVisible();
  await expect(page.getByTestId(`board-card-${board.id}`)).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("rail-whiteboard")).toBeVisible();
  await expect(page.getByTestId("whiteboard-library")).toBeVisible();
});

test('new Board dialog saves optional existing and new tags before opening', async ({ page, request: api }, testInfo) => {
  const token = cleanupToken = await login(page);
  const suffix = randomUUID().slice(0, 8);
  const tag = await apiJson<Tag>(api, token, 'POST', '/whiteboard-tags', { requestId: randomUUID(), name: `Existing-${suffix}` });
  cleanupTags.set(tag.id, tag.revision);
  await page.goto('/studio/board');
  const trigger = page.getByTestId('board-create');
  await trigger.click();
  const dialog = page.getByTestId('board-create-dialog');
  const name = page.getByTestId('board-create-name');
  await expect(name).toHaveValue('未命名白板');
  expect(await name.evaluate((element: HTMLInputElement) => [element.selectionStart, element.selectionEnd])).toEqual([0, 5]);
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(trigger).toBeFocused();
  await trigger.click();
  const defaultResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/whiteboards'));
  await page.getByTestId('board-create-confirm').click();
  const defaultCreatedResponse = await defaultResponse; expect(defaultCreatedResponse.ok()).toBe(true);
  const defaultBoard = await defaultCreatedResponse.json() as Board; cleanupBoards.add(defaultBoard.id);
  await expect(page).toHaveURL(new RegExp(`/studio/board/${defaultBoard.id}$`));
  const defaultPersisted = await apiJson<Board>(api, token, 'GET', `/whiteboards/${defaultBoard.id}`);
  expect(defaultPersisted.name).toBe('未命名白板'); expect(defaultPersisted.tagIds).toEqual([]);
  await page.goto('/studio/board');
  await trigger.click(); await name.fill(`Dialog-${suffix}`);
  await dialog.getByRole('checkbox', { name: tag.name, exact: true }).check();
  const newTagName = `New-${suffix}`;
  await dialog.getByRole('textbox', { name: '搜索或添加标签' }).fill(newTagName);
  await page.getByTestId('board-create-confirm').click();
  await expect(page.getByTestId('board-create-error')).toContainText('标签输入尚未完成');
  const tagResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/whiteboard-tags'));
  await dialog.getByRole('button', { name: `添加标签“${newTagName}”`, exact: true }).click();
  const createdTagResponse = await tagResponse; expect(createdTagResponse.ok()).toBe(true);
  const added = await createdTagResponse.json() as Tag; cleanupTags.set(added.id, added.revision);
  await expect(dialog.getByRole('checkbox', { name: newTagName, exact: true })).toBeChecked();
  await expect(page.getByTestId('board-create-error')).not.toBeVisible();
  for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    const bounds = await dialog.boundingBox(); expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(size.width);
    await page.getByTestId('board-create-confirm').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('board-create-confirm')).toBeInViewport();
    await page.screenshot({path:testInfo.outputPath(`create-dialog-${size.width}.png`)});
  }
  const createdResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/whiteboards'));
  await page.getByTestId('board-create-confirm').click();
  const response = await createdResponse; expect(response.ok()).toBe(true);
  const created = await response.json() as Board; cleanupBoards.add(created.id);
  await expect(page).toHaveURL(new RegExp(`/studio/board/${created.id}$`));
  const persisted = await apiJson<Board>(api, token, 'GET', `/whiteboards/${created.id}`);
  expect(persisted.name).toBe(`Dialog-${suffix}`); expect([...persisted.tagIds].sort()).toEqual([tag.id, added.id].sort());
});


test('library untagged filter is server paginated and cards remain usable', async ({ page, request: api }, testInfo) => {
  const token = cleanupToken = await login(page);
  const name = `Filter-${randomUUID().slice(0,8)}`;
  const tag = await apiJson<Tag>(api, token, 'POST', '/whiteboard-tags', {requestId:randomUUID(),name});
  cleanupTags.set(tag.id,tag.revision);
  const boards: Board[] = [];
  for (let i=0;i<3;i++) {
    const board = await apiJson<Board>(api,token,'POST','/whiteboards',{requestId:randomUUID(),name:`${name}-${i}`});
    boards.push(board); cleanupBoards.add(board.id);
  }
  await apiJson<Board>(api,token,'PATCH',`/whiteboards/${boards[0]!.id}`,{tagIds:[tag.id],expectedTagsRevision:0});
  const url = `/whiteboards?archived=active&limit=1&untagged=true&query=${encodeURIComponent(name)}`;
  const first = await apiJson<{items:Board[];nextCursor:string}>(api,token,'GET',url);
  expect(first.items).toHaveLength(1); expect(first.items[0]!.tagIds).toEqual([]); expect(first.nextCursor).toBeTruthy();
  const second = await apiJson<{items:Board[];nextCursor:string|null}>(api,token,'GET',`${url}&cursor=${encodeURIComponent(first.nextCursor)}`);
  expect(second.items).toHaveLength(1); expect(second.items[0]!.tagIds).toEqual([]); expect(second.nextCursor).toBeNull();
  expect(new Set([...first.items,...second.items].map(b=>b.id))).toEqual(new Set(boards.slice(1).map(b=>b.id)));
  expect((await apiFetch(api,token,'GET',`${url.replace('untagged=true','untagged=false')}&cursor=${encodeURIComponent(first.nextCursor)}`)).status()).toBe(409);
  await page.goto('/studio/board');
  await page.getByTestId('board-search').fill(name);
  await page.getByRole('button',{name:'无标签',exact:true}).click();
  await expect(page.getByTestId(`board-card-${boards[0]!.id}`)).toHaveCount(0);
  await expect(page.getByTestId(`board-card-${boards[1]!.id}`)).toBeVisible();
  await page.getByTestId(`board-filter-tag-${tag.id}`).click();
  await expect(page.getByTestId(`board-card-${boards[0]!.id}`)).toBeVisible();
  await expect(page.getByTestId(`board-card-${boards[1]!.id}`)).toHaveCount(0);
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:900});
    await page.screenshot({path:testInfo.outputPath(`library-cards-${width}.png`),fullPage:true});
  }
});
