import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

/**
 * 品牌 favicon 资产回归测试（2026-09-04，boardx/workspacex#2651 review 发现两个真实 bug 后补）：
 *
 * 1. `favicon.ico`/`favicon-48x48.ico` 曾经只嵌了一帧 16x16（`sizes` 参数配合已缩小的
 *    base image保存，Pillow 不会从小图放大出 32/48 帧，静默丢帧且不报错）——用真实
 *    ICO 头解析断言帧数与每帧尺寸，而不是信任文件名。
 * 2. 生成的图标内容在画布里不居中（裁切 bbox 计算把透明像素误判成「内容」，导致
 *    padding 基于错误的外框计算）——用最小 PNG 解码器读出 alpha 通道的实际
 *    bounding box，断言左右/上下留白对称（allow 1-2px 取整误差）。
 *
 * 这两个 bug 单靠"目视比对截图"都不会被发现（ICO 帧数目视看不出来；居中偏移在小图标
 * 上人眼也很难分辨），必须用可执行断言钉住，否则同一类回归会再次发生。
 */

const PUBLIC_DIR = join(__dirname, "..", "public");

function readIcoFrames(path: string): Array<{ width: number; height: number; size: number }> {
  const buf = readFileSync(path);
  const count = buf.readUInt16LE(4);
  const frames = [];
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16;
    const w = buf.readUInt8(off) || 256;
    const h = buf.readUInt8(off + 1) || 256;
    const size = buf.readUInt32LE(off + 8);
    frames.push({ width: w, height: h, size });
  }
  return frames;
}

/** 只需支持我们自己生成的这一类 PNG：非隔行、8-bit、RGBA（colorType 6）。 */
function decodePngRGBA(path: string): { width: number; height: number; alpha: Uint8Array } {
  const buf = readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`not a PNG: ${path}`);
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(`decodePngRGBA only supports 8-bit RGBA PNGs, got depth=${bitDepth} colorType=${colorType}`);
  }
  const raw = inflateSync(Buffer.concat(idatChunks));
  const bpp = 4; // RGBA @ 8-bit
  const stride = width * bpp;
  const alpha = new Uint8Array(width * height);
  let prevRow = new Uint8Array(stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos] ?? 0;
    pos += 1;
    const row = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[pos + x] ?? 0;
      const a: number = x >= bpp ? (row[x - bpp] ?? 0) : 0;
      const b: number = prevRow[x] ?? 0;
      const c: number = x >= bpp ? (prevRow[x - bpp] ?? 0) : 0;
      let predicted = 0;
      if (filter === 0) predicted = 0;
      else if (filter === 1) predicted = a;
      else if (filter === 2) predicted = b;
      else if (filter === 3) predicted = Math.floor((a + b) / 2);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[x] = (rawByte + predicted) & 0xff;
    }
    pos += stride;
    for (let x = 0; x < width; x++) {
      alpha[y * width + x] = row[x * bpp + 3] ?? 0;
    }
    prevRow = row;
  }
  return { width, height, alpha };
}

function alphaBoundingBox(width: number, height: number, alpha: Uint8Array, threshold = 10) {
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((alpha[y * width + x] ?? 0) > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, maxX, minY, maxY };
}

describe("品牌 favicon 资产完整性", () => {
  it("favicon.ico / favicon-48x48.ico 各自内嵌 16/32/48 三帧，且每帧真实尺寸与声明一致", () => {
    for (const name of ["favicon.ico", "favicon-48x48.ico"]) {
      const frames = readIcoFrames(join(PUBLIC_DIR, name));
      const sizes = frames.map((f) => f.width).sort((a, b) => a - b);
      expect(sizes, `${name} 应内嵌 [16,32,48] 三帧，实际 ${JSON.stringify(sizes)}`).toEqual([16, 32, 48]);
      for (const f of frames) {
        expect(f.width, `${name} 帧应为正方形`).toBe(f.height);
      }
    }
  });

  it.each([
    ["favicon-16x16.png", 16],
    ["favicon-32x32.png", 32],
    ["ms-icon-144x144.png", 144],
    ["apple-icon.png", 180],
  ] as const)("%s 尺寸正确，且品牌 X 图形标在画布中居中（留白对称）", (name, expected) => {
    const path = join(PUBLIC_DIR, name);
    expect(existsSync(path), `${path} 应存在`).toBe(true);
    const { width, height, alpha } = decodePngRGBA(path);
    expect(width).toBe(expected);
    expect(height).toBe(expected);
    const { minX, maxX, minY, maxY } = alphaBoundingBox(width, height, alpha);
    expect(maxX, `${name} 应含非透明内容`).toBeGreaterThan(minX);
    const leftMargin = minX;
    const rightMargin = width - 1 - maxX;
    const topMargin = minY;
    const bottomMargin = height - 1 - maxY;
    // 小图标缩放取整会有 1-2px 误差，允许的不对称上限按画布尺寸的 ~12% 给余量。
    const tolerance = Math.max(2, Math.round(width * 0.12));
    expect(
      Math.abs(leftMargin - rightMargin),
      `${name} 左右留白应大致对称：left=${leftMargin} right=${rightMargin}`,
    ).toBeLessThanOrEqual(tolerance);
    expect(
      Math.abs(topMargin - bottomMargin),
      `${name} 上下留白应大致对称：top=${topMargin} bottom=${bottomMargin}`,
    ).toBeLessThanOrEqual(tolerance);
  });

  it("app/layout.tsx 里 metadata.icons 声明的每个路径，在 public/ 下都能找到对应文件", () => {
    const layoutSrc = readFileSync(join(__dirname, "..", "app", "layout.tsx"), "utf-8");
    const iconsBlockMatch = layoutSrc.match(/icons:\s*{[\s\S]*?}\s*,?\s*\n\s*};/);
    expect(iconsBlockMatch, "layout.tsx 应声明 metadata.icons").toBeTruthy();
    const block = iconsBlockMatch![0];
    const urls = [...block.matchAll(/url:\s*"([^"]+)"/g)].map((m) => m[1]).filter((u): u is string => !!u);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      // metadata 里的 url 都是站点根相对路径（Next.js 把 public/ 伺服到站点根）。
      const relPath = url.replace(/^\//, "");
      const filePath = join(PUBLIC_DIR, relPath);
      expect(existsSync(filePath), `metadata.icons 引用的 ${url} 应存在于 public/`).toBe(true);
    }
  });
});
