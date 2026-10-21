// Separate process: no application credentials, URLs or file paths are accepted as input.
import { Transformer, ResizeFit } from '@napi-rs/image';
import { imageSize } from 'image-size';
import { GifReader } from 'omggif';
const { bytes: MAX_BYTES, pixels: MAX_PIXELS, dimension: MAX_SIDE, frames: MAX_FRAMES } = JSON.parse(process.argv[3]);
function check(width, height, frames = 1) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE || frames < 1 || frames > MAX_FRAMES || width * height * frames > MAX_PIXELS) throw Error('IMAGE_LIMIT');
}
function pixels(bytes, width, height) {
  const image = new Transformer(bytes), info = image.metadataSync();
  if (info.width !== width || info.height !== height) throw Error('IMAGE_DIMENSIONS');
  if (image.rawPixelsSync().length < width * height) throw Error('IMAGE_PIXELS');
}
function webp(bytes, width, height) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.readUInt32LE(4) + 8 !== bytes.length) throw Error('WEBP_LENGTH');
  let count = 0, animated = false;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw Error('WEBP_CHUNK');
    const type = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4), end = offset + 8 + size;
    if (end > bytes.length || end + (size & 1) > bytes.length) throw Error('WEBP_CHUNK');
    if (type === 'VP8X') animated = Boolean(bytes[offset + 8] & 2);
    if (type === 'ANMF') {
      if (!animated || size < 16) throw Error('WEBP_FRAME');
      count++; check(width, height, count);
      const data = bytes.subarray(offset + 8, end), x = data.readUIntLE(0, 3) * 2, y = data.readUIntLE(3, 3) * 2;
      const w = data.readUIntLE(6, 3) + 1, h = data.readUIntLE(9, 3) + 1;
      if (x + w > width || y + h > height) throw Error('WEBP_FRAME');
      const payload = data.subarray(16), header = Buffer.alloc(30);
      header.write('RIFF'); header.writeUInt32LE(payload.length + 22, 4); header.write('WEBPVP8X', 8); header.writeUInt32LE(10, 16);
      header[20] = payload.toString('ascii', 0, 4) === 'ALPH' ? 16 : 0;
      header.writeUIntLE(w - 1, 24, 3); header.writeUIntLE(h - 1, 27, 3);
      pixels(Buffer.concat([header, payload]), w, h);
    }
    offset = end + (size & 1);
  }
  if (animated && !count) throw Error('WEBP_FRAMES');
  if (!animated) pixels(bytes, width, height);
}
async function main() {
  const chunks = []; let length = 0;
  for await (const chunk of process.stdin) { length += chunk.length; if (length > MAX_BYTES) throw Error('IMAGE_SIZE'); chunks.push(chunk); }
  const bytes = Buffer.concat(chunks), mime = process.argv[2];
  if (!bytes.length) throw Error('IMAGE_EMPTY');
  if (mime === 'image/svg+xml') {
    const svg = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!/^\s*(?:<\?xml[^?]*\?>\s*)?<svg[\s>]/i.test(svg) || /<!|<(?:script|foreignObject|image|feImage|use|style|iframe|a)\b|\bon[a-z]+\s*=|\bstyle\s*=|(?:href|src)\s*=|url\s*\(/i.test(svg)) throw Error('SVG_CONTENT');
    const info = imageSize(bytes); check(info.width, info.height);
    const image = Transformer.fromSvg(svg).resize({ width: info.width, height: info.height, fit: ResizeFit.Fill }), decoded = image.metadataSync(); check(decoded.width, decoded.height);
    if (decoded.width !== info.width || decoded.height !== info.height) throw Error('SVG_DIMENSIONS');
    image.rawPixelsSync(); const png = image.pngSync(); if (png.length > MAX_BYTES) throw Error('IMAGE_SIZE');
    return { width: decoded.width, height: decoded.height, png: png.toString('base64') };
  }
  const info = imageSize(bytes), actual = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[info.type];
  if (actual !== mime) throw Error('IMAGE_MIME'); check(info.width, info.height);
  if (info.type === 'gif') {
    // omggif reports malformed LZW streams through console.log; treat warnings as rejection.
    console.log = () => { throw Error('GIF_PIXELS'); };
    if (bytes.at(-1) !== 0x3b) throw Error('GIF_TRAILER');
    const gif = new GifReader(bytes), frames = gif.numFrames(); check(gif.width, gif.height, frames);
    const rgba = new Uint8Array(gif.width * gif.height * 4);
    for (let i = 0; i < frames; i++) { const f = gif.frameInfo(i); if (!f.width || !f.height || f.x + f.width > gif.width || f.y + f.height > gif.height) throw Error('GIF_FRAME'); gif.decodeAndBlitFrameRGBA(i, rgba); }
  } else if (info.type === 'webp') webp(bytes, info.width, info.height);
  else pixels(bytes, info.width, info.height);
  return { width: info.width, height: info.height };
}
main().then(value => process.stdout.write(JSON.stringify(value))).catch(() => { process.exitCode = 1; });
