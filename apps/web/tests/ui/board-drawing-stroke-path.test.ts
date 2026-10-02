import { expect, it } from "vitest";
import { chromium } from "playwright-core";
import { drawingStrokePath } from "@/components/whiteboard/fabric/drawing-stroke-path";

it("unions adjacent pressure capsules into one consistently wound fill path", () => {
  const path = drawingStrokePath([{x:0,y:0,pressure:.5},{x:20,y:0,pressure:.5},{x:40,y:0,pressure:.5}],20);
  expect(path.match(/ Z/g)).toHaveLength(2);
  expect(path.match(/ A 6\.75 6\.75 0 0 0 /g)).toHaveLength(4);
  expect(path).not.toMatch(/NaN|Infinity/);
});

it("preserves variable pressure radii and origin translation without scaling width", () => {
  const points = [{x:100,y:200,pressure:0},{x:120,y:220,pressure:1},{x:140,y:220,pressure:1}];
  const path = drawingStrokePath(points,20,{x:100,y:200});
  expect(path).toContain("A 6.75 6.75");
  expect(path).toContain("A 10 10");
  expect(path).not.toContain("200");
  expect(path.match(/ Z/g)).toHaveLength(2);
});

it("represents repeated samples as finite same-winding discs and empty samples as no ink", () => {
  expect(drawingStrokePath([],20)).toBe("");
  expect(drawingStrokePath([{x:1,y:2,pressure:.5}],20)).toBe("");
  const path = drawingStrokePath([{x:1,y:2,pressure:0},{x:1,y:2,pressure:0}],20);
  expect(Number(path.split(" ")[5])).toBeCloseTo(4.15);
  expect(path.match(/ A /g)).toHaveLength(2);
  expect(path).not.toMatch(/NaN|Infinity/);
});

it("composites joint alpha once in real browser pixels and retains scaled eraser masks", async () => {
  const browser = await chromium.launch(process.env.PW_EXECUTABLE ? {executablePath:process.env.PW_EXECUTABLE} : {});
  try {
    const page = await browser.newPage();
    const ink = drawingStrokePath([{x:20,y:40,pressure:.5},{x:40,y:40,pressure:.5},{x:60,y:40,pressure:.5}],20);
    const erase = drawingStrokePath([{x:40,y:30,pressure:.5},{x:40,y:50,pressure:.5}],8);
    const pixels = await page.evaluate(({ink,erase}) => {
      const canvas = document.createElement("canvas"); canvas.width=160; canvas.height=160;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas 2D context unavailable");
      const alpha = (x:number,y:number):number => {
        const data = context.getImageData(x,y,1,1).data;
        if (data.length !== 4) throw new Error("Expected one RGBA pixel");
        return data[3]!;
      };
      context.fillStyle="#EF4444"; context.globalAlpha=.35; context.fill(new Path2D(ink),"nonzero");
      const joints=[alpha(30,40),alpha(40,40),alpha(50,40)];
      context.fill(new Path2D(ink),"nonzero"); const independentStroke=alpha(40,40);
      context.clearRect(0,0,160,160); context.scale(2,2); context.globalAlpha=.35; context.fill(new Path2D(ink),"nonzero");
      const scaledJoint=alpha(80,80); context.globalAlpha=1; context.globalCompositeOperation="destination-out"; context.fill(new Path2D(erase),"nonzero");
      return {joints,independentStroke,scaledJoint,erased:alpha(80,80),retained:alpha(60,80)};
    },{ink,erase});
    for(const alpha of pixels.joints) expect(Math.abs(alpha-89)).toBeLessThanOrEqual(1);
    expect(new Set(pixels.joints).size).toBe(1);
    expect(pixels.independentStroke).toBeGreaterThan(140);
    expect(pixels.scaledJoint).toBe(pixels.joints[0]);
    expect(pixels.erased).toBe(0);
    expect(pixels.retained).toBe(pixels.joints[0]);
  } finally { await browser.close(); }
},30000);

it("keeps intrinsic width suitable for scaled drawing and destination-out eraser masks", () => {
  const points = [{x:10,y:15,pressure:.5},{x:40,y:15,pressure:.5}];
  const erase = drawingStrokePath(points,24,{x:10,y:15});
  expect(erase).toContain("A 8.100000000000001 8.100000000000001");
  expect(erase.match(/ Z/g)).toHaveLength(1);
  expect(erase).not.toMatch(/opacity|source-over|destination-out/);
});
