import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { SESSION_TOKEN_STORAGE_KEY } from "../lib/api-client";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";
import { expectBoardSynced } from "./support/board-sync-status";

test("Board operation menu downloads PNG and PDF without selection chrome", async ({ page, request }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.adminEmail);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/);
  const token = await page.evaluate(key => localStorage.getItem(key), SESSION_TOKEN_STORAGE_KEY);
  const base = `http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}`;
  const headers = { Authorization: `Bearer ${token}` };
  const created = await request.post(`${base}/whiteboards`, { headers, data: { requestId: randomUUID(), name: "Board download regression" } });
  expect(created.ok()).toBeTruthy();
  const board = await created.json();
  try {
    await page.goto(`/studio/board/${board.id}`);
    await expectBoardSynced(page, 30_000);
    await page.getByRole("button", { name: "更多白板操作", exact: true }).click();
    await expect(page.getByTestId("board-download-png")).toBeVisible();
    await expect(page.getByTestId("board-present-viewport")).toHaveCount(0);
    const pngPending = page.waitForEvent("download");
    await page.getByTestId("board-download-png").click();
    const png = await pngPending;
    expect(png.suggestedFilename()).toBe("Board download regression.png");
    const pngBytes = await readFile((await png.path())!);
    expect([...pngBytes.subarray(0, 8)]).toEqual([137,80,78,71,13,10,26,10]);
    expect(pngBytes.readUInt32BE(16)).toBeGreaterThan(0);
    const pdfPending = page.waitForEvent("download");
    await page.getByTestId("board-download-pdf").click();
    const pdf = await pdfPending;
    expect(pdf.suggestedFilename()).toBe("Board download regression.pdf");
    expect((await readFile((await pdf.path())!)).subarray(0, 5).toString()).toBe("%PDF-");
  } finally {
    const current = await request.get(`${base}/whiteboards/${board.id}`, { headers });
    if (current.ok()) {
      const latest = await current.json();
      const archived = await request.patch(`${base}/whiteboards/${board.id}`, { headers, data: { archived: true, expectedLifecycleRevision: latest.lifecycleRevision } });
      if (archived.ok()) {
        const value = await archived.json();
        await request.delete(`${base}/whiteboards/${board.id}`, { headers, data: { requestId: randomUUID(), confirmation: "PERMANENTLY_DELETE", expectedLifecycleRevision: value.lifecycleRevision } });
      }
    }
  }
});
