import { expect, test, type Locator, type Page } from "@playwright/test";
import { archiveAcceptanceBoard, boardLogin, canonicalBoardSnapshot, createAcceptanceBoard, openBoard } from "./board-acceptance-support";

test.describe.configure({ mode: "serial", timeout: 120_000 });

const drawingObjects = (snapshot: Awaited<ReturnType<typeof canonicalBoardSnapshot>>) => snapshot.objects.filter((object) => {
  const content = object.extensionData?.contentObject as { type?: string } | undefined;
  return object.kind === "drawing" && content?.type === "drawing";
});

async function startStroke(page: Page, surface: Locator, offset: number) {
  const bounds = await surface.boundingBox();
  expect(bounds).not.toBeNull();
  const start = { x: bounds!.x + 320 + offset, y: bounds!.y + 240 + offset };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 80, start.y + 40, { steps: 8 });
}

test("Fabric Draw previews before commit, cancels without writes, and commits exactly one drawing", async ({ page, request }) => {
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
