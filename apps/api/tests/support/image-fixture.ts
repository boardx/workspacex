import { Transformer } from '@napi-rs/image';
import { GifWriter } from 'omggif';
export function rasterFixture(format: 'png' | 'jpeg' | 'webp' | 'gif' = 'png', width = 32, height = 24, color = [68, 136, 255, 255]) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set(color, i);
  if (format === 'gif') {
    const data = Buffer.alloc(width * height * 2 + 1024), writer = new GifWriter(data, width, height, { palette: [(color[0]! << 16) | (color[1]! << 8) | color[2]!, 0] });
    writer.addFrame(0, 0, width, height, Array<number>(width * height).fill(0));
    return data.subarray(0, writer.end());
  }
  const image = Transformer.fromRgbaPixels(rgba, width, height);
  return format === 'png' ? image.pngSync() : format === 'jpeg' ? image.jpegSync() : image.webpLosslessSync();
}
