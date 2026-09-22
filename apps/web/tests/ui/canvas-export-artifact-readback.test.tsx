/**
 * 导出产物**重新打开**验证（issue #3009）——AT-C001…C019 场景⑤ 的 vitest 那一层。
 *
 * 在此之前，本仓对画布导出的全部断言是：
 *   - PNG：`dataUrl.startsWith("data:image/png")` + `width/height > 0`。那两个数字是
 *     `exportPNG()` **自己回报**的包围盒尺寸，不是从图里量出来的——自报值和自己比
 *     永远相等。一张内容全白、包围盒却算对的图会照样绿。
 *   - PDF：断言 `exportPngAsPdf` 这个 **`vi.fn()`** 被调用过。`jspdf` 在整个套件里
 *     一次都没执行过，`.pdf` 这个后缀是断言里唯一和 PDF 有关的东西。
 *
 * 这个文件补的是「产物能被重新读回、内容可辨认」这一层，按 §1 结论规则第 4 条：
 *   ① 把 PNG data URL 真的解码成位图（`tests/support/export-artifact-readback.ts`
 *      里独立实现的解码器，不用 `exportPNG()` 自报的任何数字），量真实像素宽高，
 *      与自报的「逻辑尺寸 × multiplier」交叉核对，再数墨水证明图里真有内容；
 *   ② 同一份 data URL 喂给**真实的** `buildPdfFromPng`（不 mock jspdf），把产出的
 *      PDF 字节重新打开：`%PDF-` 魔数、页数、页面尺寸、再把页面里那张图解回像素，
 *      与导出的 PNG 逐像素比。
 *   ③ 一组**反证**：全白图、截断的 PNG、被改坏的 PDF——证明上面的判据会红。没有
 *      这一组，"绿"只说明断言写得松。
 *
 * 不做的事：**是否裁切**（标题/便签/连接线有没有被切掉）是视觉判据，归 e2e
 * （`e2e/canvas-tpl-sticky-not-clipped.spec.ts` 那条线），这里不起浏览器、也不假装
 * 自己能判。「下载权限」同理——服务端目前没有导出端点，无从在这一层验证。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Canvas as FabricCanvasType } from "fabric";
import type { DiagramModel } from "@repo/fabric-markdown";

import {
  dataUrlToBytes,
  decodePng,
  firstPixelDifference,
  flatten,
  inkRatio,
  inkRatioInColumnBand,
  readPdf,
} from "../support/export-artifact-readback";

const FLOWCHART_MARKDOWN = "```mermaid\nflowchart TD\n  X --> Y\n```";

/**
 * PDF 的 pt = 1/72 英寸，CSS 像素 = 1/96 英寸 —— 这是单位制的事实，任何 PDF 阅读器
 * 都按它量页面。测试按这个第一性原理自己算期望页面尺寸，**不复用实现里的系数**，
 * 否则系数写错时两边一起错、断言恒真。实现里的 `PX_TO_PT` 反过来被钉在它上面。
 */
const PT_PER_PX = 72 / 96;

/**
 * 与 `canvas-stage-export.test.tsx` 同款：只把 `markdownToCanvas` 里会走
 * `mermaid.render()` 的 text→model 那一跳换成固定模型，**渲染仍是真实的**
 * `renderToCanvas` + 真实 fabric —— 截出来的像素是真画的，不是编的。
 */
vi.mock("@repo/fabric-markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/fabric-markdown")>();
  return {
    ...actual,
    markdownToCanvas: async (markdown: string, canvas: FabricCanvasType) => {
      const model: DiagramModel = {
        kind: "flowchart",
        direction: "TD",
        nodes: [
          { id: "X", label: "节点X", shape: "rect", x: 0, y: 0, width: 120, height: 48 },
          { id: "Y", label: "节点Y", shape: "rect", x: 240, y: 0, width: 120, height: 48 },
        ],
        edges: [{ id: "e1", source: "X", target: "Y", kind: "open" }],
      };
      actual.renderToCanvas(model, canvas);
      return { model, block: { code: markdown, lang: "mermaid", start: 0, end: markdown.length, fence: "```" } };
    },
  };
});

import { CanvasStage, type CanvasStageHandle } from "@/components/canvas/canvas-stage";
import { PX_TO_PT, buildPdfFromPng } from "@/lib/canvas/export-image";

async function mountAndExport(): Promise<CanvasStageHandle> {
  const stageRef = { current: null as CanvasStageHandle | null };
  render(
    <CanvasStage
      ref={(r) => { stageRef.current = r; }}
      readOnly={false}
      tool="select"
      zoom={1}
      markdown={FLOWCHART_MARKDOWN}
      onMarkdownChange={vi.fn()}
    />,
  );
  await waitFor(() => expect(screen.getByTestId("canvas-fabric-surface")).toBeInTheDocument());
  await waitFor(() => expect(stageRef.current?.exportPNG()).not.toBeNull());
  return stageRef.current!;
}

/** 同尺寸的全白 PNG —— 反证用的"假产物"，走的是和真产物同一条 canvas→PNG 链路。 */
function blankPngDataUrl(widthPx: number, heightPx: number): string {
  const el = document.createElement("canvas");
  el.width = widthPx;
  el.height = heightPx;
  const ctx = el.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, widthPx, heightPx);
  return el.toDataURL("image/png");
}

describe("画布导出产物：重新打开验证（#3009）", () => {
  describe("① PNG 被真的解码回来", () => {
    it("解码出的像素尺寸 == exportPNG() 自报的 逻辑尺寸 × multiplier", async () => {
      const stage = await mountAndExport();

      // 两个不同倍率各截一次：解码出来的尺寸必须跟着倍率变。若它只是把自报值原样
      // 回声（或者根本没解码），这一对就不可能同时对上。
      const decoded = [1, 2].map((multiplier) => {
        const result = stage.exportPNG({ multiplier })!;
        expect(result.multiplier).toBe(multiplier);

        const bitmap = decodePng(dataUrlToBytes(result.dataUrl));
        // 容 1px：逻辑尺寸可能是半像素（实测 409.5×97.5），canvas 的像素尺寸只能取整，
        // 取整方向是 fabric 的实现细节，不值得把测试钉死在上面；差 1px 以上就是真错了。
        expect(Math.abs(bitmap.width - result.width * multiplier)).toBeLessThanOrEqual(1);
        expect(Math.abs(bitmap.height - result.height * multiplier)).toBeLessThanOrEqual(1);
        // 真的是带透明通道的位图，不是一堆解不开的字节。
        expect(bitmap.alpha).not.toBeNull();
        return bitmap;
      });
      // 倍率真的作用在像素上：2 倍那张确实更大（不是两次都截出同一张图）。
      expect(decoded[1]!.width).toBeGreaterThan(decoded[0]!.width);
      expect(decoded[1]!.height).toBeGreaterThan(decoded[0]!.height);
    }, 60_000);

    it("图里真的画着东西：整体有墨水，左右两个节点和中间的连接线各自成像", async () => {
      const stage = await mountAndExport();
      const image = flatten(decodePng(dataUrlToBytes(stage.exportPNG()!.dataUrl)));

      // 既不是白纸（>0），也不是糊成一整块黑（<0.9）。
      const overall = inkRatio(image);
      expect(overall).toBeGreaterThan(0.05);
      expect(overall).toBeLessThan(0.9);

      // 模型是「节点X --> 节点Y」：左右各一个矩形，中间一条连线。按竖带切开数墨水，
      // 三段都得有内容——少画一个节点、或者连线没渲出来，这里就红。
      const leftNode = inkRatioInColumnBand(image, 0, 0.2);
      const middle = inkRatioInColumnBand(image, 0.4, 0.6);
      const rightNode = inkRatioInColumnBand(image, 0.8, 1);
      expect(leftNode).toBeGreaterThan(0.05);
      expect(rightNode).toBeGreaterThan(0.05);
      expect(middle).toBeGreaterThan(0); // 连接线比节点细，只要求"有"
      // 节点那两带明显比中间的连线带更密——图不是一片均匀噪声。
      expect(leftNode).toBeGreaterThan(middle);
      expect(rightNode).toBeGreaterThan(middle);
    }, 60_000);
  });

  describe("② PDF 真的被生成，并且能重新打开", () => {
    it("真实 jspdf 产出的 PDF：单页、页面尺寸 = 逻辑尺寸×PX_TO_PT、页内图像与导出的 PNG 逐像素一致", async () => {
      const stage = await mountAndExport();
      const png = stage.exportPNG()!;

      // 这里没有 mock：`buildPdfFromPng` 内部那句 `await import("jspdf")` 真的执行。
      const doc = await buildPdfFromPng(png.dataUrl, png.width, png.height);
      const bytes = Buffer.from(doc.output("arraybuffer") as ArrayBuffer);

      expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");

      const pdf = readPdf(bytes); // 结构不对就 throw（魔数 / %%EOF / 页面树 / 图像流）
      expect(pdf.pageCount).toBe(1);
      expect(pdf.mediaBox.x0).toBe(0);
      expect(pdf.mediaBox.y0).toBe(0);
      // ⚠ 期望值按单位制**独立**算，不拿 `PX_TO_PT` 去乘：用实现里的系数算期望值，
      // 系数改错时等号两边会一起动，断言就成了恒真（写这条测试时真的栽过一次）。
      // 实现用的系数另行钉死在 PT_PER_PX 上，改了会红。
      expect(PX_TO_PT).toBe(PT_PER_PX);
      expect(pdf.mediaBox.x1).toBeCloseTo(png.width * PT_PER_PX, 2);
      expect(pdf.mediaBox.y1).toBeCloseTo(png.height * PT_PER_PX, 2);
      // 页面宽高比 == 图片宽高比：图铺满整页时不会被拉伸变形。
      expect((pdf.mediaBox.x1 - pdf.mediaBox.x0) / (pdf.mediaBox.y1 - pdf.mediaBox.y0))
        .toBeCloseTo(png.width / png.height, 3);
      // 图确实**铺满整页**：从 (0,0) 起、尺寸等于 MediaBox。被缩小一圈（四周白边）或
      // 偏移出血（内容被页面边缘切掉）都在这里现形——这是 PDF 几何层面能判的"不裁切"。
      expect(pdf.imagePlacement).toEqual({
        x: 0,
        y: 0,
        width: pdf.mediaBox.x1 - pdf.mediaBox.x0,
        height: pdf.mediaBox.y1 - pdf.mediaBox.y0,
      });

      // 页面里那张图 == 导出的那张 PNG：同尺寸、同像素、同 alpha。
      const exported = decodePng(dataUrlToBytes(png.dataUrl));
      expect({ w: pdf.image.width, h: pdf.image.height }).toEqual({ w: exported.width, h: exported.height });
      expect(firstPixelDifference(exported, pdf.image)).toBeNull();
      expect(pdf.image.alpha).not.toBeNull();
      expect(Buffer.from(pdf.image.alpha!).equals(Buffer.from(exported.alpha!))).toBe(true);

      // 解回来的图本身也要有内容——万一哪天"逐像素一致"是两张白纸一致。
      expect(inkRatio(flatten(pdf.image))).toBeGreaterThan(0.05);
    }, 60_000);
  });

  describe("③ 反证：产物缺失 / 损坏时，上面的判据必须红", () => {
    it("全白图：墨水判据给 0，'图里有内容' 不成立", async () => {
      const stage = await mountAndExport();
      const real = stage.exportPNG()!;
      const realImage = flatten(decodePng(dataUrlToBytes(real.dataUrl)));

      const blank = decodePng(dataUrlToBytes(blankPngDataUrl(realImage.width, realImage.height)));
      // 尺寸判据对这张假产物是**满足**的——单靠尺寸根本分不出白纸和真图，
      // 这正是修此 issue 前那条断言的漏洞。
      expect({ w: blank.width, h: blank.height }).toEqual({ w: realImage.width, h: realImage.height });
      // 内容判据则一刀切开：真图 > 0.05，白纸 == 0。
      expect(inkRatio(flatten(blank))).toBe(0);
      expect(inkRatio(realImage)).toBeGreaterThan(0.05);
    }, 60_000);

    it("截断的 PNG：解码器 throw，不会静默返回一张「看起来对」的图", async () => {
      const stage = await mountAndExport();
      const bytes = dataUrlToBytes(stage.exportPNG()!.dataUrl);

      expect(() => decodePng(bytes.subarray(0, Math.floor(bytes.length * 0.6)))).toThrow(/截断|inflate/);
      // 连魔数都不对的字节流同理。
      expect(() => decodePng(Buffer.from("not a png at all"))).toThrow(/魔数/);
    }, 60_000);

    it("被改坏的 PDF：截断、抹掉图像、篡改流长度，三种坏法都 throw", async () => {
      const stage = await mountAndExport();
      const png = stage.exportPNG()!;
      const doc = await buildPdfFromPng(png.dataUrl, png.width, png.height);
      const bytes = Buffer.from(doc.output("arraybuffer") as ArrayBuffer);
      expect(() => readPdf(bytes)).not.toThrow(); // 基线：完好的产物读得回来

      // a) 尾巴被砍（下载中断的典型形态）：没有 %%EOF。
      expect(() => readPdf(bytes.subarray(0, bytes.length - 40))).toThrow(/截断|%%EOF/);

      // b) 页面里没有图（"PDF 生成了但是张白纸"）：把图像 XObject 的类型抹掉。
      const noImage = Buffer.from(bytes.toString("latin1").replace(/\/Subtype \/Image/g, "/Subtype /Form0"), "latin1");
      expect(() => readPdf(noImage)).toThrow(/没有 \/DeviceRGB 图像/);

      // c) 图像流的自报长度被改大：切出来的流尾巴对不上 endstream。
      const badLength = Buffer.from(
        bytes.toString("latin1").replace(/\/Length (\d{4,})/, (_m, n: string) => `/Length ${Number(n) + 8}`),
        "latin1",
      );
      expect(badLength.equals(bytes)).toBe(false); // 确实改动了，不是空替换
      expect(() => readPdf(badLength)).toThrow(/对不上|截断/);
    }, 60_000);
  });
});
