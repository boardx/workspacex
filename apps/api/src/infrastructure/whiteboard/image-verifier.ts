import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { WHITEBOARD_ASSET_LIMITS as L, WhiteboardAssetMetadata } from '@repo/contracts/whiteboard-asset';
import { WhiteboardImageError, type BoardImageVerifier } from '../../application/whiteboard/image-assets';
let active = 0;
/** Decode pixels, not merely headers. Refuse remote resources before SVG enters libvips. */
export class SharpBoardImageVerifier implements BoardImageVerifier {
  async verify(bytes: Uint8Array, declaredMime: Parameters<BoardImageVerifier['verify']>[1]) {
    if (!bytes.byteLength || bytes.byteLength > L.bytes) throw new WhiteboardImageError('IMAGE_TOO_LARGE');
    if (active >= L.concurrentDecodes) throw new WhiteboardImageError('RATE_LIMITED');
    active++;
    try {
      if (declaredMime === 'image/svg+xml') {
        const svg = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (!/^\s*(?:<\?xml[^?]*\?>\s*)?<svg[\s>]/i.test(svg)
          || /<!|<(?:script|foreignObject|image|feImage|use|style|iframe|a)\b|\bon[a-z]+\s*=|\bstyle\s*=|(?:href|src)\s*=|url\s*\(/i.test(svg)) throw new WhiteboardImageError('INVALID_IMAGE');
      }
      const image = sharp(bytes, { animated: true, failOn: 'warning', limitInputPixels: L.pixels }).timeout({ seconds: 5 });
      const info = await image.metadata();
      const mime = ({ png:'image/png', jpeg:'image/jpeg', webp:'image/webp', gif:'image/gif', svg:'image/svg+xml' } as const)[info.format as 'png' | 'jpeg' | 'webp' | 'gif' | 'svg'];
      const width = info.width ?? 0, height = info.pageHeight ?? info.height ?? 0;
      if (mime !== declaredMime || !width || !height || width > L.dimension || height > L.dimension || width * height * (info.pages ?? 1) > L.pixels || (info.pages ?? 1) > L.frames) throw new WhiteboardImageError('INVALID_IMAGE');
      // Raw output forces a complete decode (including animation frames); its
      // allocation is bounded by the total pixel limit above.
      await image.clone().raw().toBuffer();
      const stored = mime === 'image/svg+xml' ? new Uint8Array(await image.png().toBuffer()) : new Uint8Array(bytes);
      const storedMime = mime === 'image/svg+xml' ? 'image/png' : declaredMime;
      const digest = createHash('sha256').update(stored).digest('hex');
      const metadata = WhiteboardAssetMetadata.parse({ assetId:`board-image-${digest}`, mimeType:storedMime, magicMimeType:storedMime,
        byteSize:stored.byteLength,contentDigest:`sha256:${digest}`,intrinsicWidth:width,intrinsicHeight:height,persistence:'durable' });
      return { bytes:stored, metadata };
    } catch (error) { if (error instanceof WhiteboardImageError) throw error; throw new WhiteboardImageError('INVALID_IMAGE'); }
    finally { active--; }
  }
}
