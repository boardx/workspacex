import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { AesGcmBoardBlobCodec, KmsBoardTenantKeyResolver } from '../../src/infrastructure/whiteboard/aes-gcm-board-blob-codec';
import { EnvHostedBoardClientFactory, HttpVersionedBoardMasterKeySource } from '../../src/infrastructure/whiteboard/hosted-board-provider-factory';
import { S3CompatibleBoardBlobStore } from '../../src/infrastructure/whiteboard/hosted-board-blob-store';

type Seen = { method?: string; url?: string; headers: IncomingMessage['headers']; body: Buffer };
const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))); });

async function listen(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<{ endpoint: string }> {
  const server = createServer(handler); servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing address');
  return { endpoint: `http://127.0.0.1:${address.port}` };
}

async function bodyOf(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks);
}

describe('Hosted Board production bindings over real HTTP transports', () => {
  it('uses the real ali-oss SDK with V4 authorization and forbid-overwrite', async () => {
    const seen: Seen[] = [], bytes = Buffer.from('immutable-oss');
    const { endpoint } = await listen(async (request, response) => {
      const body = await bodyOf(request); seen.push({ method: request.method, url: request.url, headers: request.headers, body });
      const url = new URL(request.url ?? '/', endpoint);
      response.setHeader('content-type', 'application/xml'); response.setHeader('x-oss-request-id', 'test-request');
      if (url.searchParams.has('versioning')) response.end('<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>');
      else if (url.searchParams.has('acl')) response.end('<AccessControlPolicy><Owner><ID>test</ID><DisplayName>test</DisplayName></Owner><AccessControlList><Grant>private</Grant></AccessControlList></AccessControlPolicy>');
      else if (url.searchParams.has('worm')) response.end('<WormConfiguration><WormState>Locked</WormState><RetentionPeriodInDays>1</RetentionPeriodInDays></WormConfiguration>');
      else if (request.method === 'PUT') { response.statusCode = 200; response.end(''); }
      else {
        response.setHeader('content-type', 'application/octet-stream'); response.setHeader('content-length', String(bytes.byteLength));
        response.setHeader('x-oss-meta-cipher-digest', 'a'.repeat(64)); response.setHeader('x-oss-meta-size-bytes', String(bytes.byteLength));
        response.end(request.method === 'HEAD' ? undefined : bytes);
      }
    });
    const client = await new EnvHostedBoardClientFactory({
      NODE_ENV: 'test', WORKSPACEX_BOARD_OSS_ENDPOINT: endpoint, WORKSPACEX_BOARD_OSS_REGION: 'cn-test', WORKSPACEX_BOARD_OSS_AUTH_MODE: 'environment',
      WORKSPACEX_BOARD_OSS_ACCESS_KEY_ID: 'test-id', WORKSPACEX_BOARD_OSS_ACCESS_KEY_SECRET: 'test-secret',
    }).create({ provider: 'aliyun-oss', bucket: 'private-board', prefix: 'board-content' });
    await expect(client.inspectBucket()).resolves.toEqual({ access: 'private', versioning: 'enabled', objectLock: 'enabled' });
    await expect(client.putIfAbsent({ key: 'tenant/key', bytes, contentType: 'application/octet-stream', metadata: { cipherDigest: 'a'.repeat(64), sizeBytes: bytes.byteLength } })).resolves.toBe('created');
    const put = seen.find(value => value.method === 'PUT');
    expect(put?.headers.authorization).toMatch(/^OSS4-HMAC-SHA256 /);
    expect(put?.headers['x-oss-forbid-overwrite']).toBe('true'); expect(put?.headers['x-oss-meta-cipher-digest']).toBe('a'.repeat(64));
    expect(put?.url).toContain('board-content/tenant/key'); expect(put?.body).toEqual(bytes);
  });

  it('uses SigV4 S3-compatible requests with conditional writes and readback metadata', async () => {
    const seen: Seen[] = [], bytes = Buffer.from('immutable-s3');
    const { endpoint } = await listen(async (request, response) => {
      const body = await bodyOf(request); seen.push({ method: request.method, url: request.url, headers: request.headers, body });
      const url = new URL(request.url ?? '/', endpoint);
      if (url.searchParams.has('versioning')) { response.end('<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>'); return; }
      if (url.searchParams.has('acl')) { response.end('<AccessControlPolicy><AccessControlList></AccessControlList></AccessControlPolicy>'); return; }
      if (url.searchParams.has('object-lock')) { response.end('<ObjectLockConfiguration><ObjectLockEnabled>Enabled</ObjectLockEnabled></ObjectLockConfiguration>'); return; }
      if (request.method === 'PUT') { response.statusCode = 200; response.end(); return; }
      response.setHeader('content-length', String(bytes.byteLength)); response.setHeader('x-amz-meta-cipher-digest', 'b'.repeat(64)); response.setHeader('x-amz-meta-size-bytes', String(bytes.byteLength));
      response.end(request.method === 'HEAD' ? undefined : bytes);
    });
    const client = await new EnvHostedBoardClientFactory({
      NODE_ENV: 'test', WORKSPACEX_BOARD_S3_ENDPOINT: `${endpoint}/gateway`, WORKSPACEX_BOARD_S3_REGION: 'auto', WORKSPACEX_BOARD_S3_ACCESS_KEY_ID: 'test-id',
      WORKSPACEX_BOARD_S3_SECRET_ACCESS_KEY: 'test-secret', WORKSPACEX_BOARD_S3_PRIVATE_ACCESS_CONFIRMED: 'true',
    }).create({ provider: 's3-compatible', bucket: 'private-board', prefix: 'board-content' });
    await expect(client.inspectBucket()).resolves.toEqual({ access: 'private', versioning: 'enabled', objectLock: 'enabled' });
    await expect(client.putIfAbsent({ key: 'tenant/key', bytes, contentType: 'application/octet-stream', metadata: { cipherDigest: 'b'.repeat(64), sizeBytes: bytes.byteLength } })).resolves.toBe('created');
    await expect(client.get('tenant/key')).resolves.toMatchObject({ bytes: new Uint8Array(bytes), cipherDigest: 'b'.repeat(64), sizeBytes: bytes.byteLength });
    const put = seen.find(value => value.method === 'PUT');
    expect(put?.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /); expect(put?.headers['if-none-match']).toBe('*');
    expect(put?.headers['x-amz-meta-cipher-digest']).toBe('b'.repeat(64)); expect(put?.body).toEqual(bytes);
    expect(put?.url).toContain('/gateway/private-board/board-content/tenant/key');
  });

  it('allows an R2-style unsupported object-lock API only when lock is not required', async () => {
    const { endpoint } = await listen(async (request, response) => {
      const url = new URL(request.url ?? '/', endpoint);
      if (url.searchParams.has('versioning')) { response.end('<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>'); return; }
      if (url.searchParams.has('acl')) { response.end('<AccessControlPolicy><AccessControlList></AccessControlList></AccessControlPolicy>'); return; }
      if (url.searchParams.has('object-lock')) { response.statusCode = 501; response.end('<Error><Code>NotImplemented</Code></Error>'); return; }
      response.statusCode = 500; response.end();
    });
    const client = await new EnvHostedBoardClientFactory({
      NODE_ENV: 'test', WORKSPACEX_BOARD_S3_ENDPOINT: endpoint, WORKSPACEX_BOARD_S3_REGION: 'auto', WORKSPACEX_BOARD_S3_ACCESS_KEY_ID: 'test-id',
      WORKSPACEX_BOARD_S3_SECRET_ACCESS_KEY: 'test-secret', WORKSPACEX_BOARD_S3_PRIVATE_ACCESS_CONFIRMED: 'true',
    }).create({ provider: 's3-compatible', bucket: 'private-board', prefix: 'board-content' });
    await expect(client.inspectBucket()).resolves.toEqual({ access: 'private', versioning: 'enabled', objectLock: 'disabled' });
    await expect(new S3CompatibleBoardBlobStore(client, { requireObjectLock: false }).assertReady()).resolves.toBeUndefined();
    await expect(new S3CompatibleBoardBlobStore(client, { requireObjectLock: true }).assertReady()).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  });

  it('resolves exact remote key versions, decrypts v1 after rotation, and rejects changed v1 material', async () => {
    const keys = new Map([[1, Buffer.alloc(32, 1).toString('base64')]]), requests: unknown[] = [];
    const { endpoint } = await listen(async (request, response) => {
      const input = JSON.parse((await bodyOf(request)).toString('utf8')) as { version: number }; requests.push(input);
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ version: input.version, keyMaterial: keys.get(input.version) }));
    });
    const codec = new AesGcmBoardBlobCodec(new KmsBoardTenantKeyResolver(new HttpVersionedBoardMasterKeySource(new URL(endpoint), 'kms-test-token')));
    const old = await codec.encrypt({ tenantId: 'org-a', tenantKeyVersion: 1, plaintext: Buffer.from('historical') });
    keys.set(2, Buffer.alloc(32, 2).toString('base64'));
    await codec.encrypt({ tenantId: 'org-a', tenantKeyVersion: 2, plaintext: Buffer.from('current') });
    await expect(codec.decrypt({ ...old, tenantId: 'org-a', expectedPlainDigest: old.plainDigest })).resolves.toEqual(new Uint8Array(Buffer.from('historical')));
    keys.set(1, Buffer.alloc(32, 9).toString('base64'));
    await expect(codec.decrypt({ ...old, tenantId: 'org-a', expectedPlainDigest: old.plainDigest })).rejects.toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE' });
    expect(requests).toContainEqual({ tenantId: 'org-a', version: 1 });
  });
});
