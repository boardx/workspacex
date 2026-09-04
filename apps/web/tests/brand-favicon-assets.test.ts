import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { crc32, inflateSync } from "node:zlib";

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
 *
 * 2026-09-04 三次加固（第三轮 review 抓到的假阳性）：`readIcoFrames`/`decodePngRGBA`
 * 之前只解析"看起来对"的字段，没有校验结构本身——把某帧的 `size` 改成远超文件长度、
 * 把 PNG 签名 8 字节里的后 4 字节改坏，测试依然 7/7 全绿：`Buffer.subarray` 越界会
 * 静默截断而不报错，签名校验只看了前 4 字节（`0x89504e47`，PNG/JFIF 等好几种格式
 * 前 4 字节都可能长这样）。现在两个解析器都校验完整结构（ICO reserved/type、目录项
 * offset/size 越界、帧间不重叠；PNG 完整 8 字节签名 + IHDR 长度）,解析不出来就抛错而
 * 不是返回一个看似合理的空/半截结果——并补了两个反例用例，证明篡改后的资产确实会
 * 让测试失败（而不是被静默放过）。
 *
 * 2026-09-04 四次加固（第四轮 review）：`decodePngRGBA` 校验了 chunk 边界和签名，
 * 但没验证每个 chunk 的 CRC32、也没检查 IHDR 里的 compression/filter/interlace
 * 方法字节——PNG 规范这三个字节目前只有 0 是合法值，我们自己的编码器也只产出 0，
 * 但解码器没把这当断言，于是一个 CRC 被改坏、或 interlace/compression/filter
 * 方法被改成非法值的帧，照样能解出"看起来对"的像素、测试照样全绿。现在每个 chunk
 * 都用 `node:zlib` 的 `crc32` 重算校验和跟文件里存的 CRC 比对，IHDR 的三个方法
 * 字节要求必须是 0，任一不满足就抛错。
 */

const PUBLIC_DIR = join(__dirname, "..", "public");

interface IcoFrame {
  width: number;
  height: number;
  size: number;
  offset: number;
  data: Buffer;
}

/**
 * 解析 ICO 目录 + 逐帧字节范围，校验到能拒绝越界/重叠的目录项——不满足就抛错，
 * 不返回一个被 `Buffer.subarray` 静默截断出来的"看似合理"的帧。
 */
/** 供反例测试直接喂被篡改过的内存 buffer；文件路径版本 `readIcoFrames` 只是它的一层包装。 */
function readIcoFramesFromBuffer(buf: Buffer, label: string): IcoFrame[] {
  if (buf.length < 6) throw new Error(`${label}: 文件太短，不足 ICONDIR 头`);
  const reserved = buf.readUInt16LE(0);
  const type = buf.readUInt16LE(2);
  if (reserved !== 0 || type !== 1) {
    throw new Error(`${label}: 不是合法 ICO（reserved=${reserved} type=${type}，应为 0/1）`);
  }
  const count = buf.readUInt16LE(4);
  const dirEnd = 6 + count * 16;
  if (buf.length < dirEnd) throw new Error(`${label}: 目录长度超出文件`);
  const frames: IcoFrame[] = [];
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16;
    const w = buf.readUInt8(off) || 256;
    const h = buf.readUInt8(off + 1) || 256;
    const size = buf.readUInt32LE(off + 8);
    const offset = buf.readUInt32LE(off + 12);
    if (size <= 0) throw new Error(`${label}: 第 ${i} 帧 size=${size}，应为正数`);
    if (offset < dirEnd) throw new Error(`${label}: 第 ${i} 帧 offset=${offset} 落进目录区（应 >= ${dirEnd}）`);
    if (offset + size > buf.length) {
      throw new Error(`${label}: 第 ${i} 帧 offset+size=${offset + size} 超出文件长度 ${buf.length}`);
    }
    for (const [rStart, rEnd] of ranges) {
      if (offset < rEnd && offset + size > rStart) {
        throw new Error(`${label}: 第 ${i} 帧 [${offset},${offset + size}) 与其他帧的字节范围重叠`);
      }
    }
    ranges.push([offset, offset + size]);
    frames.push({ width: w, height: h, size, offset, data: buf.subarray(offset, offset + size) });
  }
  return frames;
}

function readIcoFrames(path: string): IcoFrame[] {
  return readIcoFramesFromBuffer(readFileSync(path), path);
}

/** 只需支持我们自己生成的这一类 PNG：非隔行、8-bit、RGBA（colorType 6）。 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function decodePngRGBA(buf: Buffer, label: string): { width: number; height: number; alpha: Uint8Array } {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`not a valid PNG signature: ${label}`);
  }
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let sawIHDR = false;
  let sawIEND = false;
  const idatChunks: Buffer[] = [];
  let off = 8;
  while (off < buf.length) {
    if (off + 8 > buf.length) throw new Error(`${label}: chunk 头越界，PNG 被截断`);
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const dataStart = off + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > buf.length) throw new Error(`${label}: ${type} chunk 声明长度 ${len} 超出文件边界`);
    const data = buf.subarray(dataStart, dataEnd);
    const storedCrc = buf.readUInt32BE(dataEnd);
    const actualCrc = crc32(buf.subarray(off + 4, dataEnd)); // CRC 覆盖 chunk type + data，不含长度字段
    if (storedCrc !== actualCrc) {
      throw new Error(
        `${label}: ${type} chunk CRC32 校验失败（存储值 0x${storedCrc.toString(16)}，实算 0x${actualCrc.toString(16)}）`,
      );
    }
    if (type === "IHDR") {
      if (len !== 13) throw new Error(`${label}: IHDR 长度应为 13，实际 ${len}`);
      sawIHDR = true;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
      const compression = data.readUInt8(10);
      const filterMethod = data.readUInt8(11);
      const interlace = data.readUInt8(12);
      // PNG 规范目前 compression/filter method 唯一合法值是 0；interlace 是 0（无隔行）或 1（Adam7）
      // ——本仓的编码器只产出非隔行图，所以这里直接要求三者都是 0，不支持隔行版本。
      if (compression !== 0) throw new Error(`${label}: IHDR compression method 应为 0，实际 ${compression}`);
      if (filterMethod !== 0) throw new Error(`${label}: IHDR filter method 应为 0，实际 ${filterMethod}`);
      if (interlace !== 0) throw new Error(`${label}: IHDR interlace method 应为 0（非隔行），实际 ${interlace}`);
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      sawIEND = true;
      break;
    }
    off = dataEnd + 4; // skip trailing CRC32
  }
  if (!sawIHDR) throw new Error(`${label}: 缺少 IHDR chunk`);
  if (!sawIEND) throw new Error(`${label}: 缺少 IEND chunk，文件可能被截断`);
  if (width <= 0 || height <= 0) throw new Error(`${label}: IHDR 宽高非法 ${width}x${height}`);
  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(`decodePngRGBA only supports 8-bit RGBA PNGs, got depth=${bitDepth} colorType=${colorType}`);
  }
  const raw = inflateSync(Buffer.concat(idatChunks));
  const bpp = 4; // RGBA @ 8-bit
  const stride = width * bpp;
  const expectedRawLength = (stride + 1) * height; // 每行 1 字节 filter + stride 字节像素
  if (raw.length < expectedRawLength) {
    throw new Error(`${label}: 解压后的像素数据只有 ${raw.length} 字节，应至少 ${expectedRawLength}（数据被截断）`);
  }
  const alpha = new Uint8Array(width * height);
  let prevRow = new Uint8Array(stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos] ?? 0;
    if (filter < 0 || filter > 4) {
      throw new Error(`${label}: 第 ${y} 行的 filter byte=${filter} 不是合法的 PNG 逐行过滤类型（应为 0-4）`);
    }
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

  describe("反例：解析器应拒绝被篡改的资产，而不是静默放过（2026-09-04 第三轮 review 抓到的假阳性）", () => {
    it("目录项 size 越界（远超文件实际长度）应报错，而不是被 Buffer.subarray 静默截断", () => {
      const buf = Buffer.from(readFileSync(join(PUBLIC_DIR, "favicon-48x48.ico")));
      // 复刻 review 里的反例：把第 0 个目录项的 size 从真实值改成远超文件长度。
      buf.writeUInt32LE(1_006_173, 6 + 0 * 16 + 8);
      expect(() => readIcoFramesFromBuffer(buf, "corrupted-in-memory")).toThrow(/超出文件长度/);
    });

    it("嵌在 ICO 里的帧，PNG 签名后 4 字节被破坏应报错，而不是被当成合法 PNG", () => {
      const buf = Buffer.from(readFileSync(join(PUBLIC_DIR, "favicon-48x48.ico")));
      // 先在未篡改的 buffer 上定位 48px 帧的真实 offset，再去改它的字节——
      // 不能假设目录第 0 项就是 48px（实际写入顺序是 16/32/48）。
      const targetFrame = readIcoFramesFromBuffer(buf, "favicon-48x48.ico (pre-corruption)").find(
        (f) => f.width === 48,
      );
      expect(targetFrame, "favicon-48x48.ico 应有 48px 帧").toBeTruthy();
      const offset = targetFrame!.offset;
      // 复刻 review 里的反例：签名前 4 字节（0x89 'P' 'N' 'G'）不动，后 4 字节改坏。
      buf.writeUInt8(0x42, offset + 4);
      buf.writeUInt8(0x41, offset + 5);
      buf.writeUInt8(0x44, offset + 6);
      buf.writeUInt8(0x21, offset + 7);
      const frames = readIcoFramesFromBuffer(buf, "corrupted-in-memory");
      const frame = frames.find((f) => f.width === 48);
      expect(frame).toBeTruthy();
      expect(() => decodePngRGBA(Buffer.from(frame!.data), "corrupted-signature")).toThrow(/valid PNG signature/);
    });
  });

  describe("反例二：PNG 解码器应拒绝 CRC 损坏 / 不支持的 IHDR 方法字节（2026-09-04 第四轮 review 抓到的假阳性）", () => {
    /**
     * favicon-48x48.ico 的 48px 帧结构固定（已用脚本核实）：
     *   signature(8) + IHDR chunk[len4+type4+data13+crc4](offset 8..33)
     *   + 单个 IDAT chunk（offset 33，长度视压缩结果而定）+ IEND chunk[len4+type4+crc4]（0 长度数据）。
     * IHDR data 从 offset 16 开始：width(4) height(4) bitDepth(1) colorType(1)
     * compression(1)=offset26 filter(1)=offset27 interlace(1)=offset28；IHDR CRC 在 offset 29..33。
     */
    function get48pxPng(): Buffer {
      const buf = readFileSync(join(PUBLIC_DIR, "favicon-48x48.ico"));
      const frame = readIcoFramesFromBuffer(buf, "favicon-48x48.ico").find((f) => f.width === 48);
      expect(frame, "favicon-48x48.ico 应有 48px 帧").toBeTruthy();
      return Buffer.from(frame!.data);
    }

    it("IEND chunk 的 CRC32 被改坏应报错", () => {
      const png = get48pxPng();
      // IEND 是最后一个 chunk，且数据长度为 0，所以文件最后 4 字节就是它的 CRC。
      png.writeUInt32BE(0x42414421, png.length - 4); // 复刻 review 的反例：改成 "BAD!" 对应字节
      expect(() => decodePngRGBA(png, "bad-iend-crc")).toThrow(/CRC32 校验失败/);
    });

    it("IHDR 的 interlace method 被改成非法值（1）应报错", () => {
      const png = get48pxPng();
      png.writeUInt8(1, 28); // IHDR data 第 12 字节 = interlace method
      // 改了数据就要重算 CRC，否则会先撞上 CRC 校验而不是我们要测的 interlace 校验。
      png.writeUInt32BE(crc32(png.subarray(12, 29)), 29);
      expect(() => decodePngRGBA(png, "bad-interlace")).toThrow(/interlace method/);
    });

    it("IHDR 的 compression method 被改成非法值（1）应报错", () => {
      const png = get48pxPng();
      png.writeUInt8(1, 26); // IHDR data 第 10 字节 = compression method
      png.writeUInt32BE(crc32(png.subarray(12, 29)), 29);
      expect(() => decodePngRGBA(png, "bad-compression")).toThrow(/compression method/);
    });

    it("IHDR 的 filter method 被改成非法值（1）应报错", () => {
      const png = get48pxPng();
      png.writeUInt8(1, 27); // IHDR data 第 11 字节 = filter method
      png.writeUInt32BE(crc32(png.subarray(12, 29)), 29);
      expect(() => decodePngRGBA(png, "bad-filter-method")).toThrow(/filter method/);
    });
  });
});
