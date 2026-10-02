import { expect, it } from "vitest";
import { chromium } from "playwright-core";
import { drawingChoiceStyle } from "@/components/whiteboard/drawing-tool-style";
import { drawingStrokePath } from "@/components/whiteboard/fabric/drawing-stroke-path";

it("uses instrument alpha once within a stroke and source-over between independent strokes", async () => {
  const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
  try {
    const page = await browser.newPage();
    for (const choice of ["pen", "marker", "pencil", "highlighter"] as const) {
      const style = drawingChoiceStyle(choice);
      const path = drawingStrokePath([{x:20,y:40,pressure:1},{x:40,y:40,pressure:1},{x:60,y:40,pressure:1}], style.width);
      const pixels = await page.evaluate(({path,style}) => {
        const canvas=document.createElement("canvas");canvas.width=100;canvas.height=100;
        const ctx=canvas.getContext("2d");if(!ctx)throw Error("Missing Canvas2D");
        const read=(x:number)=>[...ctx.getImageData(x,40,1,1).data];
        ctx.fillStyle=style.color;ctx.globalAlpha=style.opacity;ctx.fill(new Path2D(path),"nonzero");
        const single=[read(30),read(40),read(50)];
        ctx.fill(new Path2D(path),"nonzero");return {single,double:read(40)};
      },{path,style});
      const expectedRgb=style.color.slice(1).match(/../g)!.map(value=>parseInt(value,16));
      for(const sample of [...pixels.single,pixels.double])sample.slice(0,3).forEach((channel,index)=>expect(Math.abs(channel-expectedRgb[index]!)).toBeLessThanOrEqual(2));
      for(const sample of pixels.single)expect(Math.abs(sample[3]!-255*style.opacity)).toBeLessThanOrEqual(1);
      expect(Math.abs(pixels.double[3]!-255*(1-(1-style.opacity)**2))).toBeLessThanOrEqual(1);
      expect(new Set(pixels.single.map(sample=>sample[3])).size).toBe(1);
    }
  } finally { await browser.close(); }
},30000);
