import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WHITEBOARD_ASSET_LIMITS as L, WhiteboardAssetMetadata } from '@repo/contracts/whiteboard-asset';
import { WhiteboardImageError, type BoardImageVerifier } from '../../application/whiteboard/image-assets';
let active = 0;
/** Decode in a bounded child process so native work cannot outlive the five-second deadline. */
export class DecodedBoardImageVerifier implements BoardImageVerifier {
  async verify(bytes: Uint8Array, declaredMime: Parameters<BoardImageVerifier['verify']>[1]) {
    if (!bytes.byteLength || bytes.byteLength > L.bytes) throw new WhiteboardImageError('IMAGE_TOO_LARGE');
    if (active >= L.concurrentDecodes) throw new WhiteboardImageError('RATE_LIMITED');
    active++;
    try {
      const decoded = await decodeImage(bytes, declaredMime);
      const { width, height } = decoded;
      const stored = decoded.png ? new Uint8Array(Buffer.from(decoded.png, 'base64')) : new Uint8Array(bytes);
      const storedMime = declaredMime === 'image/svg+xml' ? 'image/png' : declaredMime;
      const digest = createHash('sha256').update(stored).digest('hex');
      const metadata = WhiteboardAssetMetadata.parse({ assetId:`board-image-${digest}`, mimeType:storedMime, magicMimeType:storedMime,
        byteSize:stored.byteLength,contentDigest:`sha256:${digest}`,intrinsicWidth:width,intrinsicHeight:height,persistence:'durable' });
      return { bytes:stored, metadata };
    } catch (error) { if (error instanceof WhiteboardImageError) throw error; throw new WhiteboardImageError('INVALID_IMAGE'); }
    finally { active--; }
  }
}

function decodeImage(bytes: Uint8Array, mime: string): Promise<{ width: number; height: number; png?: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--max-old-space-size=128', fileURLToPath(new URL('./image-decoder.mjs', import.meta.url)), mime, JSON.stringify(L)],
      { stdio: ['pipe', 'pipe', 'ignore'], env: { PATH: process.env.PATH } });
    const chunks: Buffer[] = []; let size = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    child.stdout.on('data', (chunk: Buffer) => { size += chunk.length; if (size > Math.ceil(L.bytes * 4 / 3) + 1024) child.kill('SIGKILL'); else chunks.push(chunk); });
    child.stdin.on('error', () => { /* A rejected image may close stdin early. */ });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new WhiteboardImageError('INVALID_IMAGE'));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new WhiteboardImageError('INVALID_IMAGE')); }
    });
    child.stdin.end(bytes);
  });
}
