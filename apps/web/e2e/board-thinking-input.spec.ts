import { applyAcknowledgedHistory, boardProjectionWithoutIdentity, readBoardProjection } from "./support/board-history-acceptance";
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
  if (!value) throw new Error(`Missing Board thinking-input E2E fixture: ${name}`);
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

type Board = { id: string; archived: boolean; lifecycleRevision: number };
let cleanup: { boardId: string; token: string } | null = null;

test.afterEach(async () => {
  if (!cleanup) return;
  const target = cleanup;
  cleanup = null;
  const api = await playwrightRequest.newContext();
  const failures: string[] = [];
  try {
    const current = await apiFetch(api, target.token, "GET", `/whiteboards/${target.boardId}`);
    if (current.status() !== 404) {
      if (!current.ok()) failures.push(`GET Board: ${current.status()} ${await current.text()}`);
      else {
        let board = await current.json() as Board;
        if (!board.archived) {
          const archived = await apiFetch(api, target.token, "PATCH", `/whiteboards/${target.boardId}`, { archived: true, expectedLifecycleRevision: board.lifecycleRevision });
          if (!archived.ok()) failures.push(`archive Board: ${archived.status()} ${await archived.text()}`);
          else board = await archived.json() as Board;
        }
        if (board.archived) {
          const deleted = await apiFetch(api, target.token, "DELETE", `/whiteboards/${target.boardId}`, { requestId: randomUUID(), confirmation: "PERMANENTLY_DELETE", expectedLifecycleRevision: board.lifecycleRevision });
          if (!deleted.ok()) failures.push(`delete Board: ${deleted.status()} ${await deleted.text()}`);
        }
      }
    }
  } finally {
    await api.dispose();
  }
  expect(failures, `cleanup failures:\n${failures.join("\n")}`).toEqual([]);
});

test("brainstorm input creates twenty connected ideas and one-operation bulk undo", async ({ page, request: api, context }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const token = await login(page);
  const created = await apiFetch(api, token, "POST", "/whiteboards", { requestId: randomUUID(), name: `Thinking input ${randomUUID()}` });
  expect(created.ok()).toBe(true);
  const board = await created.json() as Board;
  cleanup = { boardId: board.id, token };

  await page.goto(`/studio/board/${board.id}`);
  await expect(page.getByText(BOARD_SYNCED_STATUS)).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("board-add-sticky").click();
  const editor = page.getByTestId("board-thinking-editor");
  await expect(editor).toBeFocused();
  for (let index = 1; index <= 20; index += 1) {
    await editor.fill(`想法 ${index}`);
    if (index < 20) await editor.press("Tab");
  }
  await editor.press("Control+Enter");
  const outline = page.getByTestId("board-a11y-mirror");
  await expect(outline.getByRole("button")).toHaveCount(20);
  await expect(outline.getByRole("button", { name: "图形：想法 20" })).toBeAttached();
  await expect(page.getByText(BOARD_SYNCED_STATUS)).toBeVisible({ timeout: 30_000 });

  const peer = await context.newPage();
  await peer.goto(`/studio/board/${board.id}`);
  await expect(peer.getByText(BOARD_SYNCED_STATUS)).toBeVisible({ timeout: 30_000 });
  await expect(peer.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(20);

  const beforeLastCreation = await readBoardProjection(page);
  const beforeLastCreationIds = new Set(beforeLastCreation.map(object => object.id));
  await expect.poll(() => readBoardProjection(peer)).toEqual(beforeLastCreation);
  await page.keyboard.press("Shift+N");
  await page.getByTestId("board-bulk-text").fill("Research\nDesign\nPrototype");
  await page.getByTestId("board-bulk-apply").click();
  await expect(outline.getByRole("button")).toHaveCount(23);
  await expect(peer.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(23);

  const afterLastCreation = await readBoardProjection(page);
  const createdBulk = afterLastCreation.filter(object => !beforeLastCreationIds.has(object.id));
  expect(createdBulk).toHaveLength(3);
  expect(createdBulk.map(object => object.text).sort()).toEqual(["图形：Design", "图形：Prototype", "图形：Research"]);
  await expect.poll(() => readBoardProjection(peer)).toEqual(afterLastCreation);
  await applyAcknowledgedHistory(page, "撤销");
  await expect(outline.getByRole("button")).toHaveCount(20);
  await expect(peer.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(20);
  await expect.poll(() => readBoardProjection(page)).toEqual(beforeLastCreation);
  await expect.poll(() => readBoardProjection(peer)).toEqual(beforeLastCreation);
  await applyAcknowledgedHistory(page, "重做");
  await expect(outline.getByRole("button")).toHaveCount(23);
  await expect(peer.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(23);
  const afterRedo = await readBoardProjection(page);
  expect(afterRedo.filter(object => beforeLastCreationIds.has(object.id))).toEqual(beforeLastCreation);
  const redoneBulk = afterRedo.filter(object => !beforeLastCreationIds.has(object.id));
  expect(redoneBulk).toHaveLength(3);
  expect(boardProjectionWithoutIdentity(redoneBulk)).toEqual(boardProjectionWithoutIdentity(createdBulk));
  await expect.poll(() => readBoardProjection(peer)).toEqual(afterRedo);
  await peer.close();

  await page.reload();
  await expect(page.getByText(BOARD_SYNCED_STATUS)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("board-a11y-mirror").getByRole("button")).toHaveCount(23);
  await expect.poll(() => readBoardProjection(page)).toEqual(afterRedo);
});
