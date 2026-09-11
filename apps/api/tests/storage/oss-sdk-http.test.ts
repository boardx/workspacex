import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import OSS from 'ali-oss';
import { describe, expect, it } from 'vitest';
import { ObjectExistsError, ObjectStoreUnavailableError } from '../../src/application/artifact/ports';
import { OssObjectStore, OssPhysicalPurge } from '../../src/infrastructure/storage/oss-object-store';
import { wrapOssSdk } from '../../src/infrastructure/storage/oss-sdk-client';

// Protocol fixture, NOT cloud evidence: use the real SDK and its serializers/signing/XML
// error decoder over a loopback socket; the service only implements this contract's APIs.
it('real ali-oss SDK sends write-once/integrity headers and decodes service errors', async () => {
  const objects = new Map<string, { bytes: Buffer; headers: Record<string, string> }>();
  let versioned = false;
  let bucketMissing = false;
  const requests: string[] = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    requests.push(req.method!);
    const error = (status: number, code: string) => {
      res.writeHead(status, { 'Content-Type': 'application/xml' });
      res.end(`<Error><Code>${code}</Code><Message>service error</Message><RequestId>fixture</RequestId></Error>`);
    };
    if (bucketMissing) { error(404, 'NoSuchBucket'); return; }
    if (!req.headers.authorization?.startsWith('OSS4-HMAC-SHA256 ')) { error(403, 'AccessDenied'); return; }
    if (url.searchParams.has('versioning')) {
      res.setHeader('Content-Type', 'application/xml');
      res.end(`<VersioningConfiguration>${versioned ? '<Status>Enabled</Status>' : ''}</VersioningConfiguration>`); return;
    }
    if (url.searchParams.has('acl')) {
      res.setHeader('Content-Type', 'application/xml');
      res.end('<AccessControlPolicy><Owner><ID>fixture</ID></Owner><AccessControlList><Grant>private</Grant></AccessControlList></AccessControlPolicy>'); return;
    }
    const key = decodeURIComponent(url.pathname.slice(1));
    if (req.method === 'PUT') {
      if (req.headers['x-oss-forbid-overwrite'] !== 'true') { error(400, 'MissingWriteOnce'); return; }
      if (objects.has(key)) { error(409, 'FileAlreadyExists'); return; }
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      if (req.headers['content-md5'] !== createHash('md5').update(bytes).digest('base64')) { error(400, 'InvalidDigest'); return; }
      objects.set(key, { bytes, headers: { 'content-length': String(bytes.length),
        'content-type': String(req.headers['content-type']), 'x-oss-meta-sha256': String(req.headers['x-oss-meta-sha256']) } });
      res.setHeader('ETag', `"${createHash('md5').update(bytes).digest('hex')}"`); res.end(); return;
    }
    if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204); res.end(); return; }
    const object = objects.get(key);
    if (!object) { error(404, 'NoSuchKey'); return; }
    res.writeHead(200, object.headers); res.end(req.method === 'HEAD' ? undefined : object.bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const sdk = new OSS({ accessKeyId: 'fixture-id', accessKeySecret: 'fixture-secret',
      region: 'oss-cn-hangzhou', bucket: 'test-bucket', authorizationV4: true,
      endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, cname: true, timeout: 2000 });
    const client = wrapOssSdk(sdk);
    const store = new OssObjectStore(client, 'test-bucket', 'test-deployment');
    const purge = new OssPhysicalPurge(client, 'test-bucket', 'test-deployment');
    await store.assertReady();
    const bytes = Buffer.from('真实SDK\u0000content');
    await store.putOnce('org/文件.txt', bytes, 'text/plain');
    expect(await store.get('org/文件.txt')).toEqual(bytes);
    expect(await store.head('org/文件.txt')).toEqual({ sizeBytes: bytes.length, mime: 'text/plain' });
    await expect(store.putOnce('org/文件.txt', Buffer.from('overwrite'), 'text/plain')).rejects.toBeInstanceOf(ObjectExistsError);
    expect(await purge.purgeAll(['org/文件.txt'])).toEqual([{ objectKey: 'org/文件.txt', deleted: true }]);
    expect(await store.get('org/文件.txt')).toBeNull();
    versioned = true;
    await expect(store.putOnce('other', bytes, 'text/plain')).rejects.toBeInstanceOf(ObjectStoreUnavailableError);
    bucketMissing = true;
    await expect(store.head('other')).rejects.toBeInstanceOf(ObjectStoreUnavailableError);
    expect(requests).toEqual(expect.arrayContaining(['GET', 'PUT', 'HEAD', 'DELETE']));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  }
});
