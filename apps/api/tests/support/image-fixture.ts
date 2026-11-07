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

export function animatedWebpFixture(corruptSecondFrame = false) {
  const chunk=(type:string,data:Buffer)=>{const h=Buffer.alloc(8);h.write(type);h.writeUInt32LE(data.length,4);return Buffer.concat([h,data,Buffer.alloc(data.length%2)]);};
  const source=rasterFixture('webp'),payload=source.subarray(12),extended=Buffer.alloc(10);extended[0]=2;extended.writeUIntLE(31,4,3);extended.writeUIntLE(23,7,3);
  const frame=Buffer.alloc(16);frame.writeUIntLE(31,6,3);frame.writeUIntLE(23,9,3);frame.writeUIntLE(50,12,3);
  const body=Buffer.concat([Buffer.from('WEBP'),chunk('VP8X',extended),chunk('ANIM',Buffer.alloc(6)),chunk('ANMF',Buffer.concat([frame,payload])),chunk('ANMF',Buffer.concat([frame,corruptSecondFrame?payload.subarray(0,10):payload]))]),h=Buffer.alloc(8);h.write('RIFF');h.writeUInt32LE(body.length,4);return Buffer.concat([h,body]);
}
