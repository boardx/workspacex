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
    await expect(page.getByTestId("board-present-viewport")).toHaveCount(0); // testid-gate: absent 用户暂时移除播放入口，断言其不再出现在白板 UI。
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

for (const unavailable of [false, true]) test(`nonempty Board export ${unavailable ? "rejects unavailable image bytes" : "preserves full pixels after pan and zoom"}`, async ({ page, request }, info) => {
  const { createHash } = await import("node:crypto");
  const { boardLogin, createAcceptanceBoard, canonicalBoardSnapshot, operate, object, createCommands, archiveAcceptanceBoard, boardApi } = await import("./board-acceptance-support");
  const { boardImagePngFixture } = await import("./support/board-image-fixture");
  const { decodePng, readPdf, firstPixelDifference, flatten } = await import("../tests/support/export-artifact-readback");
  const token = await boardLogin(page);
  const boardId = await createAcceptanceBoard(request, token, `Full export ${randomUUID()}`);
  let failure: unknown;
  try {
    await operate(request, token, boardId, createCommands([
      object("export-note", "sticky", -800, -400, "Full content sticky", 240, 180),
      object("export-text", "text", 900, 500, "Far outside current viewport", 280, 80),
      { ...object("export-edge", "connector", -560, -310, "Export connector", 1460, 850), connector: { fromPoint: { x: -560, y: -310 }, toPoint: { x: 900, y: 540 }, fromAnchor: "right", toAnchor: "left", type: "straight", startStyle: "none", endStyle: "arrow", label: "", lineStyle: "solid" }, style: { stroke: "#29261E" } },
    ]));
    await page.goto(`/studio/board/${boardId}`);
    await expectBoardSynced(page, 30_000);
    const png = boardImagePngFixture();
    const upload = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith(`/whiteboards/${boardId}/assets`));
    await page.getByRole("button", { name: "图片，快捷键 I" }).click();
    await page.getByLabel("上传图片").setInputFiles({ name: "verified-red.png", mimeType: "image/png", buffer: png });
    const uploaded = await upload;
    expect(uploaded.ok()).toBe(true);
    const metadata = await uploaded.json();
    expect(metadata.contentDigest).toBe(`sha256:${createHash("sha256").update(png).digest("hex")}`);
    expect(await (await boardApi(request, token, "GET", `/whiteboards/${boardId}/assets/${metadata.assetId}/content`)).body()).toEqual(png);
    await expect.poll(async () => (await canonicalBoardSnapshot(request, token, boardId)).objects.length).toBe(4);
    const snapshot = await canonicalBoardSnapshot(request, token, boardId);
    const image = snapshot.objects.find(value => value.id !== "export-note" && value.id !== "export-text" && value.id !== "export-edge")!;
    await operate(request, token, boardId, [{ type: "geometry", id: image.id, geometry: { ...image.geometry, x: 1500, y: -400, width: 256, height: 192 } }]);
    await page.reload();
    await expectBoardSynced(page, 30_000);
    const surface = page.getByTestId("board-fabric-surface");
    await surface.hover({ position: { x: 350, y: 250 } });
    await page.mouse.wheel(420, 250);
    await page.getByTestId("board-zoom-menu").click();
    await page.getByTestId("board-zoom-out").click();
    const viewport = () => surface.evaluate(element => ({ zoom: element.getAttribute("data-viewport-zoom"), x: element.getAttribute("data-viewport-pan-x"), y: element.getAttribute("data-viewport-pan-y") }));
    const beforeViewport = await viewport(), before = await canonicalBoardSnapshot(request, token, boardId);
    if (unavailable) await page.route(`**/whiteboards/${boardId}/assets/${metadata.assetId}/content`, route => route.fulfill({ status: 503, body: "Asset temporarily unavailable" }));
    await page.getByRole("button", { name: "更多白板操作", exact: true }).click();
    if (unavailable) {
      let downloads = 0; page.on("download", () => downloads++);
      await page.getByTestId("board-download-png").click();
      await expect(page.getByLabel("下载白板", { exact: true }).getByRole("alert")).toContainText("下载失败");
      expect(downloads).toBe(0);
    } else {
      const pending = page.waitForEvent("download"); await page.getByTestId("board-download-png").click();
      const pngBytes = await readFile((await (await pending).path())!);
      const bitmap = decodePng(pngBytes);
      expect(bitmap.width).toBeGreaterThan(2500); expect(bitmap.height).toBeGreaterThan(1000);
      const pixels = await page.evaluate(async base64 => {
        const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
        const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0); const data = context.getImageData(0, 0, image.width, image.height).data;
        let red = 0, yellow = 0, dark = 0;
        for (let index = 0; index < data.length; index += 4) {
          if (data[index] === 231 && data[index + 1] === 29 && data[index + 2] === 73) red++;
          if (data[index] === 248 && data[index + 1] === 215 && data[index + 2] === 110) yellow++;
          if (data[index]! < 100 && data[index + 1]! < 100 && data[index + 2]! < 100) dark++;
        }
        image.close(); return { red, yellow, dark };
      }, pngBytes.toString("base64"));
      expect(pixels.red).toBeGreaterThan(20000); expect(pixels.yellow).toBeGreaterThan(15000); expect(pixels.dark).toBeGreaterThan(100);
      const pdfPending = page.waitForEvent("download"); await page.getByTestId("board-download-pdf").click();
      const pdfBytes = await readFile((await (await pdfPending).path())!), pdf = readPdf(pdfBytes);
      expect(pdf.pageCount).toBe(1);
      expect(pdf.mediaBox.x1 - pdf.mediaBox.x0).toBeCloseTo(bitmap.width * .75, 1);
      expect(pdf.mediaBox.y1 - pdf.mediaBox.y0).toBeCloseTo(bitmap.height * .75, 1);
      expect(firstPixelDifference(flatten(bitmap), flatten(pdf.image))).toBeNull();
      await info.attach("full-board.png", { body: pngBytes, contentType: "image/png" });
      await info.attach("full-board.pdf", { body: pdfBytes, contentType: "application/pdf" });
      await info.attach("export-pixel-counts.json", { body: JSON.stringify({ pixels, width: bitmap.width, height: bitmap.height, beforeViewport }), contentType: "application/json" });
    }
    expect(await viewport()).toEqual(beforeViewport);
    expect(await canonicalBoardSnapshot(request, token, boardId)).toEqual(before);
  } catch (error) { failure = error; throw error; }
  finally { try { await archiveAcceptanceBoard(request, token, boardId); } catch (cleanupError) { if (failure) await info.attach("secondary-cleanup-error", { body: String(cleanupError), contentType: "text/plain" }); else throw cleanupError; } }
});
