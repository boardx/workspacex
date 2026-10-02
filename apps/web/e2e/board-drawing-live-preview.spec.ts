import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { archiveAcceptanceBoard, boardLogin, canonicalBoardSnapshot, createAcceptanceBoard, openBoard, boardApi, createCommands, object } from "./board-acceptance-support";

test.describe.configure({ mode: "serial", timeout: 120_000 });

const drawingObjects = (snapshot: Awaited<ReturnType<typeof canonicalBoardSnapshot>>) => snapshot.objects.filter((object) => {
  const content = object.extensionData?.contentObject as { type?: string } | undefined;
  return object.kind === "drawing" && content?.type === "drawing";
});

async function paintedStrokePixels(page: Page) {
  return page.getByTestId("board-fabric-surface").evaluate(surface => {
    const canvas = surface.querySelector<HTMLCanvasElement>("canvas.lower-canvas");
    if (!canvas) throw new Error("DRAWING_CANVAS_REQUIRED");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("DRAWING_PIXELS_REQUIRED");
    const zoom = Number(surface.getAttribute("data-viewport-zoom"));
    const panX = Number(surface.getAttribute("data-viewport-pan-x")), panY = Number(surface.getAttribute("data-viewport-pan-y"));
    if (!Number.isFinite(zoom) || zoom <= 0 || ![panX, panY].every(Number.isFinite)) throw new Error("DRAWING_VIEWPORT_REQUIRED");
    const ratioX = canvas.width / canvas.getBoundingClientRect().width, ratioY = canvas.height / canvas.getBoundingClientRect().height;
    const x = Math.round((520 * zoom + panX) * ratioX), y = Math.round((420 * zoom + panY) * ratioY);
    const pixels = context.getImageData(x - 1, y - 1, 3, 3).data;
    return [...pixels].filter((_value,index) => index % 4 === 3 && pixels[index]! > 0).length;
  });
}

async function startStroke(page: Page, surface: Locator, offset: number) {
  const bounds = await surface.boundingBox();
  expect(bounds).not.toBeNull();
  const start = { x: bounds!.x + 320 + offset, y: bounds!.y + 240 + offset };
  for (const point of [start, { x: start.x + 80, y: start.y + 40 }]) {
    expect(await page.evaluate(({x, y}) => document.elementFromPoint(x, y)?.matches("canvas.upper-canvas") ?? false, point)).toBe(true);
  }
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 80, start.y + 40, { steps: 8 });
}

test("Fabric Draw previews before commit, cancels without writes, and commits exactly one drawing", async ({ page, request }) => {
  // Keep the committed third stroke clear of the Draw panel, as in the eraser case.
  await page.setViewportSize({width: 1280, height: 900});
  const token = await boardLogin(page);
  const boardId = await createAcceptanceBoard(request, token, "Draw live preview acceptance");
  try {
    await openBoard(page, boardId, 0);
    await page.getByTestId("board-add-draw").click();
    const surface = page.getByTestId("board-fabric-surface");
    const upperCanvas = surface.locator("canvas.upper-canvas");
    await expect(upperCanvas).toHaveCount(1);

    await startStroke(page, surface, 0);
    await expect.poll(async () => Number(await surface.getAttribute("data-drawing-preview-segments"))).toBeGreaterThan(0);
    expect(drawingObjects(await canonicalBoardSnapshot(request, token, boardId))).toHaveLength(0);
    await upperCanvas.dispatchEvent("pointercancel", { bubbles: true, pointerId: 1, pointerType: "mouse" });
    await expect(surface).toHaveAttribute("data-drawing-preview-segments", "0");
    await page.mouse.up();
    expect(drawingObjects(await canonicalBoardSnapshot(request, token, boardId))).toHaveLength(0);

    await startStroke(page, surface, 40);
    await expect.poll(async () => Number(await surface.getAttribute("data-drawing-preview-segments"))).toBeGreaterThan(0);
    await upperCanvas.dispatchEvent("lostpointercapture", { bubbles: true, pointerId: 2, pointerType: "mouse" });
    await expect(surface).toHaveAttribute("data-drawing-preview-segments", "0");
    await page.mouse.up();
    expect(drawingObjects(await canonicalBoardSnapshot(request, token, boardId))).toHaveLength(0);

    await startStroke(page, surface, 80);
    await expect.poll(async () => Number(await surface.getAttribute("data-drawing-preview-segments"))).toBeGreaterThan(0);
    expect(drawingObjects(await canonicalBoardSnapshot(request, token, boardId))).toHaveLength(0);
    await page.mouse.up();
    await expect(surface).toHaveAttribute("data-drawing-preview-segments", "0");
    await expect.poll(async () => drawingObjects(await canonicalBoardSnapshot(request, token, boardId)).length).toBe(1);

    const [drawing] = drawingObjects(await canonicalBoardSnapshot(request, token, boardId));
    const content = drawing?.extensionData?.contentObject as { type: string; strokes: Array<{ tool: string; points: Array<{ pressure: number }> }> } | undefined;
    expect(content?.type).toBe("drawing");
    expect(content?.strokes).toHaveLength(1);
    expect(content?.strokes[0]?.tool).toBe("pen");
    expect(content?.strokes[0]?.points.length).toBeGreaterThan(1);
    expect(content?.strokes[0]?.points.every((point) => Number.isFinite(point.pressure))).toBe(true);
  } finally {
    await archiveAcceptanceBoard(request, token, boardId);
  }
});


test("Eraser hits only unlocked drawings in one undo step and survives peer reload", async ({page, request}) => {
  // At the default 720px height the Draw panel covers the second stroke's start.
  await page.setViewportSize({width: 1280, height: 900});
  const token = await boardLogin(page);
  const boardId = await createAcceptanceBoard(request, token, "Eraser durable acceptance");
  let peer: Page | undefined;
  try {
    await openBoard(page, boardId, 0);
    await page.getByTestId("board-add-draw").click();
    const surface = page.getByTestId("board-fabric-surface");
    for (const [index, offset] of [80, 160].entries()) {
      // A selected drawing receives another stroke. Deselect through the canvas
      // before creating the second independent drawing.
      const selectTool = page.getByTestId("board-tool-select");
      await selectTool.click();
      await expect(selectTool).toHaveAttribute("aria-pressed", "true");
      await surface.locator("canvas.upper-canvas").click({position:{x:120,y:120}});
      await expect(page.getByTestId("board-a11y-selection-announcement")).toHaveText("未选择对象");
      await page.getByTestId("board-add-draw").click();
      await startStroke(page, surface, offset);
      await page.mouse.up();
      await expect.poll(async () => drawingObjects(await canonicalBoardSnapshot(request, token, boardId)).length).toBe(index + 1);
    }
    await expect.poll(async () => drawingObjects(await canonicalBoardSnapshot(request, token, boardId)).length).toBe(2);
    const before = await canonicalBoardSnapshot(request, token, boardId);
    const drawing = drawingObjects(before)[0]!;
    const locked = {...drawing, id: "locked-drawing", locked: true,
      geometry: {...drawing.geometry, x: 600, y: 320}, orderKey: "locked-drawing"};
    // Keep a Sticky in the eraser path without occluding the second stroke pixel probe.
    const sticky = object("eraser-sticky", "sticky", 400, 320, "Keep this sticky", 180, 40);
    await boardApi(request, token, "POST", `/whiteboards/${boardId}/commands`, {
      requestId: randomUUID(), epoch: 1, commands: createCommands([locked, sticky]),
    });
    await expect(page.getByTestId("board-a11y-mirror").locator("li[data-object-id]")).toHaveCount(4);
    const baseline = (await canonicalBoardSnapshot(request, token, boardId)).objects.sort((a,b)=>a.id.localeCompare(b.id));
    peer = await page.context().newPage();
    await openBoard(peer, boardId, 4);
    await expect.poll(() => paintedStrokePixels(page)).toBeGreaterThan(0);
    await page.getByTestId("board-draw-eraser").click();
    const bounds = (await surface.boundingBox())!;
    await page.mouse.move(bounds.x + 400, bounds.y + 320);
    await page.mouse.down();
    for (const [x, y] of [[480,360],[480,400],[560,440],[640,340]]) {
      await page.mouse.move(bounds.x + x!, bounds.y + y!, {steps: 8});
    }
    await page.mouse.up();
    // Erasing masks vectors; it preserves object identity for later editing.
    const current = async () => (await canonicalBoardSnapshot(request, token, boardId)).objects.sort((a,b)=>a.id.localeCompare(b.id));
    await expect.poll(async () => drawingObjects(await canonicalBoardSnapshot(request, token, boardId))
      .filter(row=>!row.locked).map(row=>(row.extensionData?.contentObject as {strokes:Array<{tool:string}>}).strokes.filter(stroke=>stroke.tool==="eraser").length)).toEqual([1,1]);
    await expect.poll(() => paintedStrokePixels(page)).toBe(0);
    const erased = await current();
    expect(erased.map(row=>row.id)).toEqual(baseline.map(row=>row.id));
    for (const id of [locked.id,sticky.id]) expect(erased.find(row=>row.id===id)).toEqual(baseline.find(row=>row.id===id));
    for (const original of drawingObjects(before)) {
      const result = erased.find(row=>row.id===original.id)!;
      const oldStrokes = (original.extensionData?.contentObject as {strokes:Array<{id:string}>}).strokes;
      const strokes = (result.extensionData?.contentObject as {strokes:Array<{tool:string;erases?:string[];points:unknown[]}>}).strokes;
      expect(strokes.slice(0,-1)).toEqual(oldStrokes);
      expect(strokes.at(-1)).toMatchObject({tool:"eraser",erases:oldStrokes.map(stroke=>stroke.id)});
      expect(strokes.at(-1)!.points.length).toBeGreaterThan(1);
    }
    await page.getByRole("button", {name:"撤销", exact:true}).click();
    await expect.poll(current).toEqual(baseline);
    await expect.poll(() => paintedStrokePixels(page)).toBeGreaterThan(0);
    await page.getByRole("button", {name:"重做", exact:true}).click();
    await expect.poll(current).toEqual(erased);
    await expect.poll(() => paintedStrokePixels(page)).toBe(0);
    await Promise.all([page.reload(), peer.reload()]);
    for (const tab of [page, peer]) {
      const mirror = tab.getByTestId("board-a11y-mirror");
      await expect(mirror.locator("li[data-object-id]")).toHaveCount(4);
      await expect.poll(() => mirror.locator("li[data-object-id]").evaluateAll(rows =>
        rows.map(row => row.getAttribute("data-object-id")).sort())).toEqual(erased.map(row => row.id).sort());
      for (const protectedObject of [locked, sticky]) {
        const row = mirror.locator(`li[data-object-id="${protectedObject.id}"]`);
        await expect(row).toBeVisible();
        await expect.poll(async () => JSON.parse(await row.getAttribute("data-geometry") ?? "null"))
          .toEqual(protectedObject.geometry);
        await expect(row).toHaveAttribute("data-object-text", protectedObject.text ?? "");
      }
      await expect(tab.getByText(/^已同步(?: · 序列 \d+)?$/)).toBeVisible();
      await expect.poll(() => paintedStrokePixels(tab)).toBe(0);
    }
    expect(await current()).toEqual(erased);
  } finally {
    await peer?.close();
    await archiveAcceptanceBoard(request, token, boardId);
  }
});
