import { createServer, type Server } from 'node:https';
import { createHash, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type ImageFixtureMode = 'valid' | 'no-cors' | 'malformed-range';
export type ImageFixtureReceipt = { method: string; path: string; origin: string | undefined; range: string | undefined; status: number; bytes: number; mode: ImageFixtureMode };
/** Real loopback HTTPS bytes fixture. CORS failures must be assessed by the browser, not Node HTTP. */
export async function startImageFixture(png: Buffer, allowedOrigin: string) {
  const directory = mkdtempSync(join(tmpdir(), 'wsx-image-https-'));
  let server: Server | undefined;
  let mode: ImageFixtureMode = 'valid';
  const receipts: ImageFixtureReceipt[] = [];
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'), '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
    server = createServer({ key: readFileSync(join(directory, 'key.pem')), cert: readFileSync(join(directory, 'cert.pem')) }, (request, response) => {
      const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
      if (mode !== 'no-cors' && request.headers.origin === allowedOrigin) {
        headers['Access-Control-Allow-Origin'] = allowedOrigin;
        headers['Vary'] = 'Origin';
        headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
        headers['Access-Control-Allow-Headers'] = 'Range';
        headers['Access-Control-Expose-Headers'] = 'Content-Range, Content-Length';
      }
      let status: number, bytes: Buffer;
      if (request.url !== '/image.png') { status = 404; bytes = Buffer.alloc(0); }
      else if (request.method === 'OPTIONS') { status = 204; bytes = Buffer.alloc(0); }
      else if (request.method !== 'GET') { status = 405; bytes = Buffer.alloc(0); }
      else {
        status = 206;
        bytes = mode === 'malformed-range' ? png.subarray(8) : png;
        headers['Content-Type'] = 'image/png';
        headers['Content-Range'] = `bytes ${mode === 'malformed-range' ? 8 : 0}-${png.length - 1}/${png.length}`;
        headers['Content-Length'] = String(bytes.length);
      }
      receipts.push({ method: request.method ?? '', path: request.url ?? '', origin: request.headers.origin, range: request.headers.range, status, bytes: bytes.length, mode });
      response.writeHead(status, headers); response.end(bytes);
    });
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('HTTPS_FIXTURE_ADDRESS_INVALID');
    return {
      url: `https://127.0.0.1:${address.port}/image.png`, receipts,
      certificateSha256: createHash('sha256').update(new X509Certificate(readFileSync(join(directory,'cert.pem'))).raw).digest('hex'),
      setMode(next: ImageFixtureMode) { mode = next; },
      async close() { try { server!.closeAllConnections(); await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); } finally { rmSync(directory, { recursive: true, force: true }); } },
    };
  } catch (error) { server?.closeAllConnections(); server?.close(); rmSync(directory, { recursive: true, force: true }); throw error; }
}
