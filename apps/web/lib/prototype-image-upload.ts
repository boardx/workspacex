/**
 * 深度 S10（#3988）—— 把用户选的一张图变成能放进原型的 `image.src`（data URL）。
 *
 * 契约只收 png / jpeg / webp / gif 的 data URL，且不超过 `PROTOTYPE_IMAGE_SRC_MAX_CHARS`
 * （一次 patch 请求装得下）。手机拍的照片动辄几 MB，所以这里**先缩再压**：长边缩到
 * `MAX_SIDE`，按 JPEG 质量从高到低试，还不够就再把尺寸减半——直到装得下为止。
 * 试到最小还装不下（极少见：一张全是噪点的巨图）就说出来，不硬塞、不静默截断。
 *
 * JPEG 没有透明：透明的地方铺白底，免得变成一片黑。
 */
import { designPrototype } from "@repo/contracts";

const MAX_SIDE = 960;
const MIN_SIDE = 240;
const QUALITIES = [0.85, 0.72, 0.6, 0.48] as const;

export class ImageTooLargeError extends Error {
  constructor() {
    super("这张图压缩之后还是太大，放不进原型。换一张小一点的，或者先裁掉不要的部分。");
  }
}

export class NotAnImageError extends Error {
  constructor() {
    super("这不是一张能读的图片（支持 PNG、JPEG、WebP、GIF）。");
  }
}

async function decode(file: Blob): Promise<{ readonly source: CanvasImageSource; readonly w: number; readonly h: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (img.naturalWidth === 0 || img.naturalHeight === 0) throw new NotAnImageError();
    return { source: img, w: img.naturalWidth, h: img.naturalHeight };
  } catch (err) {
    throw err instanceof NotAnImageError ? err : new NotAnImageError();
  } finally {
    // 解码完再收回：`decode()` 之后图已经在内存里，画到 canvas 不再需要这个地址。
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** 缩放到长边不超过 `side`，按给定质量编码成 JPEG data URL。 */
function encode(source: CanvasImageSource, w: number, h: number, side: number, quality: number): string {
  const k = Math.min(1, side / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  const g = canvas.getContext("2d");
  if (g === null) throw new NotAnImageError();
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

export async function fileToImageSrc(file: Blob): Promise<string> {
  if (!file.type.startsWith("image/")) throw new NotAnImageError();
  const { source, w, h } = await decode(file);
  // 起始尺寸一定试一次（本来就比 `MIN_SIDE` 小的图不能一次都不试），之后减半到 `MIN_SIDE` 为止。
  const sides: number[] = [];
  for (let side = Math.min(MAX_SIDE, Math.max(w, h)); sides.length === 0 || side >= MIN_SIDE; side = Math.floor(side / 2)) sides.push(side);
  for (const side of sides) {
    for (const q of QUALITIES) {
      const src = encode(source, w, h, side, q);
      if (src.length <= designPrototype.PROTOTYPE_IMAGE_SRC_MAX_CHARS && designPrototype.PROTOTYPE_IMAGE_SRC_PATTERN.test(src)) return src;
    }
  }
  throw new ImageTooLargeError();
}
