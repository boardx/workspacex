/**
 * 导出产物**重新读回**的解码器（issue #3009）。
 *
 * 为什么需要它：验收方案 §1 结论规则第 4 条要求「承诺文件产物时，必须重新打开并
 * 验证结构」。在此之前 `canvas-stage-export.test.tsx` 对 PNG 只判前缀 + `exportPNG()`
 * **自报**的 width/height，从没把 base64 解回位图；PDF 那半边断言的对象是一个
 * `vi.fn()`，`jspdf` 在整个套件里一次都没跑过。自报值和自己比永远相等——那不是验证。
 *
 * 这里不引第三方解码库（`sharp`/`pngjs`/`pdfjs` 要么带原生依赖、要么是几 MB 的包，
 * 而且"产物能被**别的**实现读懂"这件事，用一个独立写的解码器来证才有意义）：PNG
 * 和 PDF 的图像流都是 zlib + PNG 预测器，`node:zlib` 足够，两边共用同一段去滤波代码。
 *
 * 只支持 8 bit、非隔行、RGB/RGBA/灰度 —— 浏览器 `canvas.toDataURL("image/png")` 和
 * jsPDF `addImage` 的输出都落在这个范围内。遇到范围外的输入一律 **throw**，不做兜底
 * 返回：解码器静默降级就等于把"产物坏了"变成"测试照绿"，正是本 issue 要根治的病。
 */
import zlib from "node:zlib";

export interface Bitmap {
  width: number;
  height: number;
  /** 每像素 3 字节（RGB），**未与背景合成**——透明处保留原始通道值。 */
  rgb: Uint8Array;
  /** 每像素 1 字节的 alpha；源图没有 alpha 通道时为 null。 */
  alpha: Uint8Array | null;
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * PNG 去滤波：inflate 之后的数据是 `[filterType, ...scanline]` 逐行排列。PDF 的
 * `/DecodeParms <</Predictor ≥10 …>>` 用的是同一套滤波器，所以两边共用这一段。
 */
function unfilter(raw: Buffer, width: number, height: number, channels: number): Uint8Array {
  const stride = width * channels;
  const expected = (stride + 1) * height;
  if (raw.length < expected) {
    throw new Error(`图像数据被截断：期望 ${expected} 字节，实到 ${raw.length}`);
  }
  const out = new Uint8Array(stride * height);
  let prevRow = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const row = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels]! : 0; // 左
      const b = prevRow[i]!; // 上
      const c = i >= channels ? prevRow[i - channels]! : 0; // 左上
      const x = row[i]!;
      let v: number;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`未知的 PNG 滤波器类型 ${filter}（第 ${y} 行）—— 数据已损坏`);
      }
      cur[i] = v & 0xff;
    }
    out.set(cur, y * stride);
    prevRow = cur;
  }
  return out;
}

/** 交错的 n 通道样本 → 独立的 RGB 平面 + alpha 平面。 */
function splitChannels(samples: Uint8Array, pixels: number, channels: number): { rgb: Uint8Array; alpha: Uint8Array | null } {
  if (channels === 3) return { rgb: samples, alpha: null };
  const rgb = new Uint8Array(pixels * 3);
  const alpha = channels === 4 ? new Uint8Array(pixels) : null;
  for (let i = 0; i < pixels; i++) {
    if (channels === 1) {
      rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = samples[i]!;
      continue;
    }
    rgb[i * 3] = samples[i * 4]!;
    rgb[i * 3 + 1] = samples[i * 4 + 1]!;
    rgb[i * 3 + 2] = samples[i * 4 + 2]!;
    alpha![i] = samples[i * 4 + 3]!;
  }
  return { rgb, alpha };
}

/**
 * 把 alpha 合成到背景色上——**看图的人看到的是这个**。画布导出的 PNG 底是透明的，
 * 透明处 RGB 恒为 (0,0,0)；不合成就去数"非白像素"，整张图都会被算成墨水，判据失效。
 */
export function flatten(bitmap: Bitmap, background: readonly [number, number, number] = [255, 255, 255]): Bitmap {
  if (!bitmap.alpha) return bitmap;
  const rgb = new Uint8Array(bitmap.width * bitmap.height * 3);
  for (let i = 0; i < bitmap.width * bitmap.height; i++) {
    const a = bitmap.alpha[i]! / 255;
    for (let c = 0; c < 3; c++) {
      rgb[i * 3 + c] = Math.round(bitmap.rgb[i * 3 + c]! * a + background[c]! * (1 - a));
    }
  }
  return { width: bitmap.width, height: bitmap.height, rgb, alpha: null };
}

/** `data:image/png;base64,…` → 原始字节。不是 PNG data URL 就 throw。 */
export function dataUrlToBytes(dataUrl: string): Buffer {
  const m = /^data:image\/png;base64,([\s\S]+)$/.exec(dataUrl);
  if (!m) throw new Error(`不是 PNG data URL：${dataUrl.slice(0, 40)}…`);
  return Buffer.from(m[1]!, "base64");
}

/** 把 PNG 字节真正解码成位图。魔数 / IHDR / IDAT 任一处对不上就 throw。 */
export function decodePng(bytes: Buffer): Bitmap {
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("PNG 魔数不对：这不是一张 PNG");
  }
  let offset = 8;
  let width = 0, height = 0, channels = 0;
  let sawIhdr = false;
  const idat: Buffer[] = [];
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (data.length < length) throw new Error(`PNG 的 ${type} 块被截断`);
    if (type === "IHDR") {
      sawIhdr = true;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8]!, colorType = data[9]!, interlace = data[12]!;
      if (bitDepth !== 8) throw new Error(`只支持 8 bit PNG，实到 ${bitDepth}`);
      if (interlace !== 0) throw new Error("不支持隔行 PNG");
      if (colorType === 0) channels = 1;
      else if (colorType === 2) channels = 3;
      else if (colorType === 6) channels = 4;
      else throw new Error(`只支持灰度/RGB/RGBA PNG，实到 colorType=${colorType}`);
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (!sawIhdr) throw new Error("PNG 缺 IHDR 块");
  if (idat.length === 0) throw new Error("PNG 缺 IDAT 块：没有任何图像数据");
  let raw: Buffer;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch (e) {
    throw new Error(`PNG 图像流 inflate 失败（数据已损坏）：${(e as Error).message}`);
  }
  const { rgb, alpha } = splitChannels(unfilter(raw, width, height, channels), width * height, channels);
  return { width, height, rgb, alpha };
}

export interface PdfReadback {
  /** 页数（`/Type /Page` 对象个数，与 `/Pages` 的 `/Count` 交叉核对过）。 */
  pageCount: number;
  /** 第一页的 `/MediaBox`，单位 pt。 */
  mediaBox: { x0: number; y0: number; x1: number; y1: number };
  /** 第一页嵌的那张图，已解回像素（alpha 来自 `/SMask`，没有就是 null）。 */
  image: Bitmap;
  /** 那张图在页面上的摆放（pt，PDF 的左下原点坐标系）。 */
  imagePlacement: { x: number; y: number; width: number; height: number };
}

/**
 * 取 `N 0 obj` 的起始下标（latin1 下标即字节下标）。
 *
 * 只返回起点、不返回终点：带 stream 的对象里是压缩后的二进制，完全可能撞上
 * "endobj" 这六个字节（实测撞过），按它切区间会把对象拦腰截断。
 */
function findIndirectObjectStart(text: string, num: number): number {
  const m = new RegExp(`(?:^|[^0-9])(${num}\\s+0\\s+obj)`, "g");
  const hit = m.exec(text);
  if (!hit) throw new Error(`PDF 里找不到对象 ${num} 0 obj`);
  return hit.index + hit[0].length - hit[1]!.length;
}

/**
 * 取出某个字典后面那段 stream 的原始字节（该解压的解压）。
 *
 * 按字典自报的 /Length 切，不按扫 `endstream`：压缩后的二进制里完全可能撞上
 * "endstream" 这九个字节（实测撞过），扫出来的边界会把流拦腰截断。切完再核对
 * 紧跟着的确实是 `endstream`——这一步同时验了「自报长度 == 实际流长度」。
 */
function readStream(text: string, bytes: Buffer, dict: string, dictEnd: number): Buffer {
  const streamKeyword = text.indexOf("stream", dictEnd);
  if (streamKeyword < 0) throw new Error("对象没有 stream 段");
  let dataStart = streamKeyword + "stream".length;
  if (text[dataStart] === "\r") dataStart++;
  if (text[dataStart] === "\n") dataStart++;
  const declaredLength = Number(/\/Length\s+(\d+)/.exec(dict)?.[1] ?? NaN);
  if (!Number.isFinite(declaredLength)) throw new Error("stream 缺 /Length");
  const dataEnd = dataStart + declaredLength;
  if (!/^\s*endstream/.test(text.slice(dataEnd, dataEnd + 20))) {
    throw new Error(`stream 的 /Length ${declaredLength} 与实际流长度对不上：PDF 被截断或改坏`);
  }
  const raw = bytes.subarray(dataStart, dataEnd);
  if (!/\/Filter\s*\/FlateDecode/.test(dict)) return Buffer.from(raw);
  try {
    return zlib.inflateSync(raw);
  } catch (e) {
    throw new Error(`stream inflate 失败（流已损坏）：${(e as Error).message}`);
  }
}

/** 解 PDF 里一个图像 XObject 的 stream（支持 /FlateDecode + PNG 预测器）。 */
function decodePdfImageStream(
  text: string,
  bytes: Buffer,
  dict: string,
  dictEnd: number,
  width: number,
  height: number,
  channels: number,
): Uint8Array {
  if (!/\/Filter\s*\/FlateDecode/.test(dict)) {
    throw new Error("图像流不是 /FlateDecode —— 解不开，也说明压缩设置被改坏了");
  }
  const raw = readStream(text, bytes, dict, dictEnd);
  // Predictor ≥ 10 = PNG 滤波器（逐行一个 filter 字节）；缺省/＜10 = 无预测器。
  const predictor = Number(/\/Predictor\s+(\d+)/.exec(dict)?.[1] ?? 1);
  if (predictor >= 10) return unfilter(raw, width, height, channels);
  const expected = width * height * channels;
  if (raw.length < expected) {
    throw new Error(`图像数据被截断：期望 ${expected} 字节，实到 ${raw.length}`);
  }
  return new Uint8Array(raw.subarray(0, expected));
}

/** 从 `<<` 开始匹配到配对的 `>>`（字典里嵌着子字典，必须数嵌套）。 */
function matchDict(text: string, open: number): { dict: string; dictEnd: number } {
  if (open < 0 || text.slice(open, open + 2) !== "<<") throw new Error("这里不是字典的起始 <<");
  let depth = 0;
  for (let i = open; i < text.length - 1; i++) {
    if (text[i] === "<" && text[i + 1] === "<") { depth++; i++; continue; }
    if (text[i] === ">" && text[i + 1] === ">") {
      depth--;
      if (depth === 0) return { dict: text.slice(open, i), dictEnd: i };
      i++;
    }
  }
  throw new Error("字典没有闭合");
}

/**
 * 从某个 `/Subtype /Image` 命中位置往回取它的字典文本。
 *
 * ⚠ 必须数嵌套：图像字典里嵌着 `/DecodeParms <<…>>`，直接找第一个 `>>` 会在内层
 * 收口（实测就是这么栽的——截断后的字典看不到 `/Filter`，测试报出来的原因完全跑偏）。
 */
function imageDictAt(text: string, at: number): { dict: string; dictEnd: number } {
  return matchDict(text, text.lastIndexOf("<<", at));
}

/**
 * 页面内容流里那张图是怎么摆的：`w 0 0 h x y cm /Ixx Do` 这条变换矩阵。
 * 用来判「图铺满整页」——图被缩小、挪位或旋转（矩阵里出现斜项）都在这里现形。
 */
function readImagePlacement(text: string, bytes: Buffer): { x: number; y: number; width: number; height: number } {
  const ref = /\/Contents\s+(\d+)\s+0\s+R/.exec(text);
  if (!ref) throw new Error("页面没有 /Contents：这一页什么都没画");
  const objStart = findIndirectObjectStart(text, Number(ref[1]));
  const { dict, dictEnd } = matchDict(text, text.indexOf("<<", objStart));
  const content = readStream(text, bytes, dict, dictEnd).toString("latin1");
  const cm = /([\d.-]+)\s+0\s+0\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+cm\s*\/\w+\s+Do/.exec(content);
  if (!cm) throw new Error(`页面内容流里没有"画一张图"的指令：${content.slice(0, 120)}`);
  return { width: Number(cm[1]), height: Number(cm[2]), x: Number(cm[3]), y: Number(cm[4]) };
}

/**
 * 把 PDF 字节重新"打开"：核结构、量页面、把页面里那张图解回像素。
 *
 * 用 latin1 串做定位是刻意的——latin1 与字节一一对应，串下标即字节下标，因此对
 * `stream` 段可以精确切字节，不会被多字节编码搓坏。
 */
export function readPdf(bytes: Buffer): PdfReadback {
  const text = bytes.toString("latin1");
  if (!text.startsWith("%PDF-")) throw new Error("PDF 魔数不对：开头不是 %PDF-");
  if (!/%%EOF\s*$/.test(text)) throw new Error("PDF 没有以 %%EOF 收尾：文件被截断");

  const pageCount = [...text.matchAll(/\/Type\s*\/Page(?![s\w])/g)].length;
  if (pageCount === 0) throw new Error("PDF 里一个页面对象都没有");
  const count = /\/Type\s*\/Pages[\s\S]*?\/Count\s+(\d+)/.exec(text);
  if (count && Number(count[1]) !== pageCount) {
    throw new Error(`PDF 页面树自相矛盾：/Count ${count[1]}，实际 ${pageCount} 个页面对象`);
  }

  const mb = /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(text);
  if (!mb) throw new Error("PDF 第一页没有 /MediaBox：页面尺寸无从判断");
  const mediaBox = { x0: Number(mb[1]), y0: Number(mb[2]), x1: Number(mb[3]), y1: Number(mb[4]) };

  // 一页里可能有多个图像 XObject（彩色图本体 + 它的 /SMask 灰度图），挑 DeviceRGB 那张。
  const colorImage = [...text.matchAll(/\/Subtype\s*\/Image/g)]
    .map((m) => imageDictAt(text, m.index!))
    .find((d) => /\/ColorSpace\s*\/DeviceRGB/.test(d.dict));
  if (!colorImage) throw new Error("PDF 里没有 /DeviceRGB 图像 XObject：这一页是空的");
  const { dict, dictEnd } = colorImage;
  const num = (key: string): number => {
    const m = new RegExp(`/${key}\\s+(\\d+)`).exec(dict);
    if (!m) throw new Error(`图像 XObject 缺 /${key}`);
    return Number(m[1]);
  };
  const width = num("Width");
  const height = num("Height");
  const rgb = decodePdfImageStream(text, bytes, dict, dictEnd, width, height, 3);

  // 透明度被 jsPDF 拆进 /SMask（一张同尺寸的 DeviceGray 图）。
  let alpha: Uint8Array | null = null;
  const smaskRef = /\/SMask\s+(\d+)\s+0\s+R/.exec(dict);
  if (smaskRef) {
    const objStart = findIndirectObjectStart(text, Number(smaskRef[1]));
    const at = text.slice(objStart).search(/\/Subtype\s*\/Image/);
    if (at < 0) throw new Error("/SMask 指向的对象不是图像");
    const sm = imageDictAt(text, objStart + at);
    const smWidth = Number(/\/Width\s+(\d+)/.exec(sm.dict)?.[1]);
    const smHeight = Number(/\/Height\s+(\d+)/.exec(sm.dict)?.[1]);
    if (smWidth !== width || smHeight !== height) {
      throw new Error(`/SMask 尺寸 ${smWidth}×${smHeight} 与图像 ${width}×${height} 不一致`);
    }
    alpha = decodePdfImageStream(text, bytes, sm.dict, sm.dictEnd, width, height, 1);
  }

  return { pageCount, mediaBox, image: { width, height, rgb, alpha }, imagePlacement: readImagePlacement(text, bytes) };
}

/**
 * 「图里有没有内容」的判据：非背景色像素占比。**传进来的位图必须已经 `flatten`**，
 * 否则透明处的 (0,0,0) 会被当成墨水。
 *
 * 一张全白的图 `inkRatio` 恒为 0——这正是本 issue 里那句「内容全白但包围盒算对的图
 * 会照样绿」要挡住的东西。阈值由调用方决定：不同画布的墨水占比本来就不同，写死在
 * 这里就成了第二份事实。
 */
export function inkRatio(
  bitmap: Bitmap,
  background: readonly [number, number, number] = [255, 255, 255],
  tolerance = 12,
): number {
  let ink = 0;
  const total = bitmap.width * bitmap.height;
  for (let i = 0; i < total; i++) {
    if (
      Math.abs(bitmap.rgb[i * 3]! - background[0]!) > tolerance ||
      Math.abs(bitmap.rgb[i * 3 + 1]! - background[1]!) > tolerance ||
      Math.abs(bitmap.rgb[i * 3 + 2]! - background[2]!) > tolerance
    ) ink++;
  }
  return total === 0 ? 0 : ink / total;
}

/** 按宽度比例切出一条竖带再数墨水——用来判"左边那个节点到底画出来了没有"。 */
export function inkRatioInColumnBand(bitmap: Bitmap, fromFraction: number, toFraction: number): number {
  const x0 = Math.max(0, Math.floor(bitmap.width * fromFraction));
  const x1 = Math.min(bitmap.width, Math.ceil(bitmap.width * toFraction));
  const width = Math.max(0, x1 - x0);
  if (width === 0) return 0;
  const band = new Uint8Array(width * bitmap.height * 3);
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * bitmap.width + x0 + x) * 3;
      const dst = (y * width + x) * 3;
      band[dst] = bitmap.rgb[src]!;
      band[dst + 1] = bitmap.rgb[src + 1]!;
      band[dst + 2] = bitmap.rgb[src + 2]!;
    }
  }
  return inkRatio({ width, height: bitmap.height, rgb: band, alpha: null });
}

/** 两张位图逐像素比：返回第一处不一致的坐标，完全一致返回 null。 */
export function firstPixelDifference(a: Bitmap, b: Bitmap): { x: number; y: number; a: number[]; b: number[] } | null {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`尺寸不同，无法逐像素比：${a.width}×${a.height} vs ${b.width}×${b.height}`);
  }
  for (let i = 0; i < a.width * a.height; i++) {
    if (a.rgb[i * 3] !== b.rgb[i * 3] || a.rgb[i * 3 + 1] !== b.rgb[i * 3 + 1] || a.rgb[i * 3 + 2] !== b.rgb[i * 3 + 2]) {
      return {
        x: i % a.width,
        y: Math.floor(i / a.width),
        a: [a.rgb[i * 3]!, a.rgb[i * 3 + 1]!, a.rgb[i * 3 + 2]!],
        b: [b.rgb[i * 3]!, b.rgb[i * 3 + 1]!, b.rgb[i * 3 + 2]!],
      };
    }
  }
  return null;
}
