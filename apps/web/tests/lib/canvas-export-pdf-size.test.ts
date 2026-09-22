/**
 * `buildPdfFromPng` 的体积反证——2026-09-18 真实事故：一张 mindmap 导出的 PDF 64 MB。
 * 根因是 jsPDF `addImage` 默认 `compression: "NONE"`，把 PNG 解码成裸位图写进 PDF。
 *
 * 这里用真实 jsPDF（不 mock）喂一张合成的 1200×1800 RGBA PNG：
 *   - 裸位图体积 = 1200×1800×3 ≈ 6.5 MB（NONE 模式下 PDF 至少这么大）；
 *   - 修复后 PDF 应远小于裸位图（Flate 后与 PNG 本身同量级），且图像流带 FlateDecode。
 * 若有人把 compression 改回 NONE，本测试立刻红。
 */
import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import { buildPdfFromPng } from "@/lib/canvas/export-image";

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]!) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** 白底 + 网格线的 RGBA PNG——模拟 mindmap 那种大片留白、少量线条文字的图。 */
function syntheticPng(W: number, H: number): Buffer {
  const stride = W * 4 + 1;
  const raw = Buffer.alloc(stride * H);
  for (let y = 0; y < H; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < W; x++) {
      const o = y * stride + 1 + x * 4;
      const line = x % 97 === 0 || y % 131 === 0;
      raw[o] = line ? 30 : 255;
      raw[o + 1] = line ? 90 : 255;
      raw[o + 2] = line ? 200 : 255;
      raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA（与浏览器 canvas.toDataURL 的输出同型）
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("buildPdfFromPng —— PDF 里的图像必须 Flate 压缩，不许塞裸位图", () => {
  it("1200×1800 的图：PDF 远小于裸位图，且图像流带 /FlateDecode", async () => {
    const W = 1200, H = 1800;
    const png = syntheticPng(W, H);
    const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
    const doc = await buildPdfFromPng(dataUrl, W, H);
    const bytes = doc.output("arraybuffer");
    const rawBitmapBytes = W * H * 3;
    // 修复前（NONE）这里 ≈ rawBitmapBytes（6.5 MB）；修复后应该在 PNG 体积的量级。
    expect(bytes.byteLength).toBeLessThan(rawBitmapBytes / 10);
    expect(bytes.byteLength).toBeLessThan(png.length * 4 + 20_000);
    const text = Buffer.from(bytes).toString("latin1");
    expect(text).toMatch(/\/Filter\s*\/FlateDecode/);
  }, 60_000);
});
