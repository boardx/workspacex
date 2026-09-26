import { expect, test } from "@playwright/test";

const BOARD_ID = process.env.BOARD_FABRIC_E2E_BOARD_ID ?? "00000000-0000-4000-8000-000000000019";

test("fabric surface viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/studio/board/${BOARD_ID}`);

  const surface = page.getByTestId("board-fabric-surface");
  const canvas = page.getByTestId("board-fabric-canvas");
  await expect(surface).toBeVisible();
  await expect(canvas).toBeVisible();

  const bounds = await surface.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeLessThanOrEqual(1);
  expect(bounds!.y).toBeLessThanOrEqual(1);
  expect(bounds!.x + bounds!.width).toBeGreaterThanOrEqual(1279);
  expect(bounds!.y + bounds!.height).toBeGreaterThanOrEqual(799);

  // The semantic mirror may use DOM controls. Board objects themselves must not
  // fall back to the legacy absolute-positioned whiteboard buttons.
  await expect(page.locator('[data-testid^="whiteboard-object-"]')).toHaveCount(0);
  await expect(page.getByTestId("board-a11y-mirror")).toBeAttached();
  const outlineButtons = page.getByTestId("board-a11y-mirror").getByRole("button");
  expect(await outlineButtons.count()).toBeGreaterThanOrEqual(4);

  // A real browser canvas must contain painted pixels. A mounted but empty
  // <canvas> would satisfy visibility and is therefore insufficient evidence.
  const paintedSamples = await canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement;
    const context = target.getContext("2d");
    if (!context) return 0;
    const pixels = context.getImageData(0, 0, target.width, target.height).data;
    let painted = 0;
    for (let offset = 3; offset < pixels.length; offset += 4 * 64) {
      if (pixels[offset] !== 0) painted += 1;
    }
    return painted;
  });
  expect(paintedSamples).toBeGreaterThan(10);

  const zoomOut = page.getByTestId("board-zoom-out");
  const zoomIn = page.getByTestId("board-zoom-in");
  for (let index = 0; index < 40; index += 1) await zoomOut.click();
  await expect(page.getByTestId("board-zoom-value")).toHaveText("5%");
  for (let index = 0; index < 80; index += 1) await zoomIn.click();
  await expect(page.getByTestId("board-zoom-value")).toHaveText("800%");

  const fitSelection = page.getByTestId("board-zoom-fit-selection");
  await expect(fitSelection).toBeDisabled();
  await outlineButtons.first().click();
  await expect(fitSelection).toBeEnabled();
  await fitSelection.click();
  await page.getByTestId("board-zoom-fit-board").click();

  const beforePan = await canvas.screenshot();
  await page.getByTestId("board-tool-hand").click();
  const canvasBounds = await canvas.boundingBox();
  expect(canvasBounds).not.toBeNull();
  await page.mouse.move(canvasBounds!.x + 400, canvasBounds!.y + 300);
  await page.mouse.down();
  await page.mouse.move(canvasBounds!.x + 520, canvasBounds!.y + 380, { steps: 8 });
  await page.mouse.up();
  const afterPan = await canvas.screenshot();
  expect(afterPan.equals(beforePan)).toBe(false);
});
