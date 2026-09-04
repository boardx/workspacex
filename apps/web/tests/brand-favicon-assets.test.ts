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
 *    bounding box，断言左右/上下留白对称（1-2px 取整误差）。
 *
 * 这两个 bug 单靠"目视比对截图"都不会被发现（ICO 帧数目视看不出来；居中偏移在小图标
 * 上人眼也很难分辨），必须用可执行断言钉住，否则同一类回归会再次发生。
 *
 * 2026-09-04 二次加固（同一 PR 上的第二轮 review）：居中断言原先按画布尺寸的 12% 给容差，
 * 和注释里写的「1-2px」名不副实——之前生成的资产本来就已经对称到 ~1px，12% 的容差没有
 * 拦住任何真实回归，只是看起来在测；改成固定 2px。另外 ICO 解析只读了目录项声明的
 * 宽高，没有解开每帧内嵌的 PNG 校验它自己的 IHDR 是否真和目录项一致（万一目录项和帧体
 * 对不上，之前那种"文件名说 48x48、实际只有 16x16"的错法在自身内部也能重现）——现在直接
 * 复用同一个 PNG 解码器解开每一帧，并把 16/32 两帧的原始字节与独立的
 * favicon-16x16.png / favicon-32x32.png 做逐字节比对（两者理应是同一份数据）。
 */

const PUBLIC_DIR = join(__dirname, "..", "public");

interface IcoFrame {
  width: number;
  height: number;
  size: number;
  data: Buffer;
}

function readIcoFrames(path: string): IcoFrame[] {
  const buf = readFileSync(path);
  const count = buf.readUInt16LE(4);
  const frames: IcoFrame[] = [];
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16;
    const w = buf.readUInt8(off) || 256;
    const h = buf.readUInt8(off + 1) || 256;
    const size = buf.readUInt32LE(off + 8);
    const offset = buf.readUInt32LE(off + 12);
    frames.push({ width: w, height: h, size, data: buf.subarray(offset, offset + size) });
  }
  return frames;
}

/** 只需支持我们自己生成的这一类 PNG：非隔行、8-bit、RGBA（colorType 6）。 */
function decodePngRGBA(buf: Buffer, label: string): { width: number; height: number; alpha: Uint8Array } {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`not a PNG: ${label}`);
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
  it("favicon.ico / favicon-48x48.ico 各自内嵌 16/32/48 三帧，每帧目录尺寸与帧体自身 PNG IHDR 一致", () => {
    for (const name of ["favicon.ico", "favicon-48x48.ico"]) {
      const frames = readIcoFrames(join(PUBLIC_DIR, name));
      const sizes = frames.map((f) => f.width).sort((a, b) => a - b);
      expect(sizes, `${name} 应内嵌 [16,32,48] 三帧，实际 ${JSON.stringify(sizes)}`).toEqual([16, 32, 48]);
      for (const f of frames) {
        expect(f.width, `${name} 目录项应为正方形`).toBe(f.height);
        // 目录项只是声明；真正决定浏览器渲染尺寸的是帧体自己的 PNG IHDR——两者必须一致，
        // 否则会重现"文件名/目录说是一个尺寸，解出来是另一个"的同类错法。
        const decoded = decodePngRGBA(Buffer.from(f.data), `${name}#${f.width}`);
        expect(decoded.width, `${name} 的 ${f.width}px 目录项，帧体 PNG 实际宽度`).toBe(f.width);
        expect(decoded.height, `${name} 的 ${f.width}px 目录项，帧体 PNG 实际高度`).toBe(f.height);
      }
    }
  });

  it("favicon.ico 的 16/32 两帧与独立的 favicon-16x16.png / favicon-32x32.png 逐字节相同", () => {
    const frames = readIcoFrames(join(PUBLIC_DIR, "favicon.ico"));
    const byWidth = new Map(frames.map((f) => [f.width, f]));
    for (const [size, standaloneName] of [
      [16, "favicon-16x16.png"],
      [32, "favicon-32x32.png"],
    ] as const) {
      const frame = byWidth.get(size);
      expect(frame, `favicon.ico 应有 ${size}px 帧`).toBeTruthy();
      const standalone = readFileSync(join(PUBLIC_DIR, standaloneName));
      expect(
        Buffer.compare(frame!.data, standalone),
        `favicon.ico 的 ${size}px 帧应与 ${standaloneName} 是同一份 PNG 数据`,
      ).toBe(0);
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
    const { width, height, alpha } = decodePngRGBA(readFileSync(path), name);
    expect(width).toBe(expected);
    expect(height).toBe(expected);
    const { minX, maxX, minY, maxY } = alphaBoundingBox(width, height, alpha);
    expect(maxX, `${name} 应含非透明内容`).toBeGreaterThan(minX);
    const leftMargin = minX;
    const rightMargin = width - 1 - maxX;
    const topMargin = minY;
    const bottomMargin = height - 1 - maxY;
    // 当前生成的资产实测对称到 ~1px；容差固定给 2px 取整余量，不按画布尺寸放大
    // ——按比例给容差（之前是 12%）在小图标上等于没有断言，拦不住真实的居中回归。
    const tolerance = 2;
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
