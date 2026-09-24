import { createHash, createHmac } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { AesGcmBoardBlobCodec, KmsBoardTenantKeyResolver } from '../../src/infrastructure/whiteboard/aes-gcm-board-blob-codec';
import { EnvHostedBoardClientFactory, HttpVersionedBoardMasterKeySource } from '../../src/infrastructure/whiteboard/hosted-board-provider-factory';
import { S3CompatibleBoardBlobStore } from '../../src/infrastructure/whiteboard/hosted-board-blob-store';

type Seen = { method?: string; url?: string; headers: IncomingMessage['headers']; body: Buffer };
const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))); });

async function listen(handler: (request: IncomingMessage, response: ServerResponse) => Promise<void> | void): Promise<{ endpoint: string }> {
  const server = createServer((request, response) => { void Promise.resolve(handler(request, response)).catch(error => { response.statusCode = 500; response.end(String(error)); }); });
  servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing address');
  return { endpoint: `http://127.0.0.1:${address.port}` };
}

async function bodyOf(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks);
}

const sha256 = (value: Uint8Array | string): string => createHash('sha256').update(value).digest('hex');
const hmac = (key: Uint8Array | string, value: string): Buffer => createHmac('sha256', key).update(value).digest();
const awsEncode = (value: string): string => encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

function verifySigV4(request: IncomingMessage, body: Buffer, secret: string): void {
  const authorization = request.headers.authorization;
  if (!authorization) throw new Error('missing authorization');
  const match = authorization.match(/^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/);
  if (!match) throw new Error('invalid authorization');
  const [, , date, region, signedNames, actualSignature] = match;
  const signedHeaders = signedNames!.split(';');
  const canonicalHeaders = signedHeaders.map(name => {
    const value = request.headers[name];
    if (value === undefined) throw new Error(`missing signed header ${name}`);
    return `${name}:${(Array.isArray(value) ? value.join(',') : value).trim().replace(/\s+/g, ' ')}`;
  }).join('\n') + '\n';
  const url = new URL(request.url ?? '/', 'http://fixture');
  const query = [...url.searchParams.entries()].map(([key, value]) => [awsEncode(key), awsEncode(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
    .map(([key, value]) => `${key}=${value}`).join('&');
  const payloadHash = String(request.headers['x-amz-content-sha256']);
  if (/^[0-9a-f]{64}$/.test(payloadHash) && payloadHash !== sha256(body)) throw new Error('payload hash mismatch');
  const canonical = [request.method, url.pathname, query, canonicalHeaders, signedNames, payloadHash].join('\n');
  const amzDate = String(request.headers['x-amz-date']);
  const scope = `${date}/${region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`;
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secret}`, date!), region!), 's3'), 'aws4_request');
  const expected = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  if (expected !== actualSignature) throw new Error(`signature mismatch for ${canonical}`);
}

function xml(response: ServerResponse, value: string): void {
  response.setHeader('content-type', 'application/xml'); response.end(value);
}

type AwsPolicyFixture = { publicPolicy?: boolean; incompletePab?: boolean };
async function awsFixture(options: AwsPolicyFixture = {}): Promise<{ endpoint: string; seen: Seen[] }> {
  const seen: Seen[] = [], stored = Buffer.from('immutable-s3');
  const result = await listen(async (request, response) => {
    const body = await bodyOf(request); seen.push({ method: request.method, url: request.url, headers: request.headers, body });
    try { verifySigV4(request, body, 'test-secret'); } catch (error) { response.statusCode = 403; xml(response, `<Error><Code>SignatureDoesNotMatch</Code><Message>${String(error)}</Message></Error>`); return; }
    const url = new URL(request.url ?? '/', 'http://fixture');
    if (url.searchParams.has('versioning')) { xml(response, '<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>'); return; }
    if (url.searchParams.has('publicAccessBlock')) {
      xml(response, `<PublicAccessBlockConfiguration><BlockPublicAcls>${options.incompletePab ? 'false' : 'true'}</BlockPublicAcls><IgnorePublicAcls>true</IgnorePublicAcls><BlockPublicPolicy>true</BlockPublicPolicy><RestrictPublicBuckets>true</RestrictPublicBuckets></PublicAccessBlockConfiguration>`); return;
    }
    if (url.searchParams.has('policyStatus')) { xml(response, `<PolicyStatus><IsPublic>${options.publicPolicy ? 'true' : 'false'}</IsPublic></PolicyStatus>`); return; }
    if (url.searchParams.has('acl')) {
      xml(response, '<AccessControlPolicy><Owner><ID>owner</ID></Owner><AccessControlList><Grant><Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser"><ID>owner</ID></Grantee><Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>'); return;
    }
    if (url.searchParams.has('object-lock')) { xml(response, '<ObjectLockConfiguration><ObjectLockEnabled>Enabled</ObjectLockEnabled></ObjectLockConfiguration>'); return; }
    if (request.method === 'PUT') { response.statusCode = 200; response.setHeader('etag', '"fixture"'); response.end(); return; }
    response.setHeader('content-length', String(stored.byteLength)); response.setHeader('x-amz-meta-cipher-digest', 'b'.repeat(64)); response.setHeader('x-amz-meta-size-bytes', String(stored.byteLength));
    response.end(request.method === 'HEAD' ? undefined : stored);
  });
  return { endpoint: result.endpoint, seen };
}

const s3Env = (endpoint: string, profile: 'aws-s3' | 'minio' | 'r2', extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test', WORKSPACEX_BOARD_S3_ENDPOINT: endpoint, WORKSPACEX_BOARD_S3_PROFILE: profile, WORKSPACEX_BOARD_S3_REGION: 'us-test-1',
  WORKSPACEX_BOARD_S3_ACCESS_KEY_ID: 'test-id', WORKSPACEX_BOARD_S3_SECRET_ACCESS_KEY: 'test-secret', WORKSPACEX_BOARD_S3_SESSION_TOKEN: 'test-session', ...extra,
});

describe('Hosted Board production bindings over real HTTP transports', () => {
  it('uses the real ali-oss SDK, enforces exact private ACL and non-public bucket policy', async () => {
    const seen: Seen[] = [], bytes = Buffer.from('immutable-oss');
    const { endpoint } = await listen(async (request, response) => {
      const body = await bodyOf(request); seen.push({ method: request.method, url: request.url, headers: request.headers, body });
      const url = new URL(request.url ?? '/', 'http://fixture');
      response.setHeader('x-oss-request-id', 'test-request');
      if (url.searchParams.has('versioning')) xml(response, '<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>');
      else if (url.searchParams.has('acl')) xml(response, '<AccessControlPolicy><Owner><ID>test</ID></Owner><AccessControlList><Grant>private</Grant></AccessControlList></AccessControlPolicy>');
      else if (url.searchParams.has('policy')) { response.setHeader('content-type', 'application/json'); response.end('{"Version":"1","Statement":[]}'); }
      else if (url.searchParams.has('worm')) xml(response, '<WormConfiguration><WormState>Locked</WormState><RetentionPeriodInDays>1</RetentionPeriodInDays></WormConfiguration>');
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
    expect(put?.headers.authorization).toMatch(/^OSS4-HMAC-SHA256 /); expect(put?.headers['x-oss-forbid-overwrite']).toBe('true');
    expect(put?.headers['x-oss-meta-cipher-digest']).toBe('a'.repeat(64)); expect(put?.body).toEqual(bytes);
  });

  it('rejects an OSS public-principal bucket policy', async () => {
    const { endpoint } = await listen(async (request, response) => {
      const url = new URL(request.url ?? '/', 'http://fixture');
      if (url.searchParams.has('versioning')) xml(response, '<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>');
      else if (url.searchParams.has('acl')) xml(response, '<AccessControlPolicy><Owner><ID>test</ID><DisplayName>test</DisplayName></Owner><AccessControlList><Grant>private</Grant></AccessControlList></AccessControlPolicy>');
      else if (url.searchParams.has('policy')) { response.setHeader('content-type', 'application/json'); response.end('{"Statement":[{"Effect":"Allow","Principal":"*"}]}'); }
      else xml(response, '<WormConfiguration><WormState>Locked</WormState></WormConfiguration>');
    });
    const client = await new EnvHostedBoardClientFactory({ NODE_ENV: 'test', WORKSPACEX_BOARD_OSS_ENDPOINT: endpoint, WORKSPACEX_BOARD_OSS_REGION: 'cn-test', WORKSPACEX_BOARD_OSS_AUTH_MODE: 'environment', WORKSPACEX_BOARD_OSS_ACCESS_KEY_ID: 'id', WORKSPACEX_BOARD_OSS_ACCESS_KEY_SECRET: 'secret' })
      .create({ provider: 'aliyun-oss', bucket: 'private-board', prefix: 'content' });
    await expect(client.inspectBucket()).resolves.toMatchObject({ access: 'public' });
  });

  it('defers OSS ecs-role credential lookup until the real readiness operation', async () => {
    const client = await new EnvHostedBoardClientFactory({
      NODE_ENV: 'test', WORKSPACEX_BOARD_OSS_ENDPOINT: 'http://127.0.0.1:1', WORKSPACEX_BOARD_OSS_REGION: 'cn-test',
      WORKSPACEX_BOARD_OSS_AUTH_MODE: 'ecs-role', WORKSPACEX_BOARD_OSS_ROLE_NAME: 'board-role',
    }).create({ provider: 'aliyun-oss', bucket: 'private-board', prefix: 'content' });
    expect(client.provider).toBe('aliyun-oss');
  });

  it('uses official S3 commands and independently verifies path-prefix and special-key SigV4', async () => {
    const fixture = await awsFixture(), bytes = Buffer.from('immutable-s3');
    const client = await new EnvHostedBoardClientFactory(s3Env(`${fixture.endpoint}/gateway%20root`, 'aws-s3'))
      .create({ provider: 's3-compatible', bucket: 'private-board', prefix: 'board-content' });
    await expect(client.inspectBucket()).resolves.toEqual({ access: 'private', versioning: 'enabled', objectLock: 'enabled' });
    await expect(client.putIfAbsent({ key: 'tenant/space %/中文', bytes, contentType: 'application/octet-stream', metadata: { cipherDigest: 'b'.repeat(64), sizeBytes: bytes.byteLength } })).resolves.toBe('created');
    const put = fixture.seen.find(value => value.method === 'PUT');
    expect(put?.headers['if-none-match']).toBe('*'); expect(put?.headers['x-amz-security-token']).toBe('test-session'); expect(put?.body).toEqual(bytes);
    expect(put?.url).toContain('/gateway%20root/private-board/board-content/tenant/space%20%25/%E4%B8%AD%E6%96%87');
  });

  it.each([{ publicPolicy: true }, { incompletePab: true }])('fails closed for unsafe AWS governance: %o', async unsafe => {
    const fixture = await awsFixture(unsafe);
    const client = await new EnvHostedBoardClientFactory(s3Env(fixture.endpoint, 'aws-s3')).create({ provider: 's3-compatible', bucket: 'private-board', prefix: 'content' });
    await expect(client.inspectBucket()).rejects.toBeDefined();
  });

  it('checks R2 public domains via management API and never calls unsupported S3 bucket APIs', async () => {
    const s3Calls: string[] = [];
    const s3 = await listen(async (request, response) => { s3Calls.push(request.url ?? ''); response.statusCode = 500; response.end(); });
    const management = await listen(async (request, response) => {
      expect(request.headers.authorization).toBe('Bearer management-token'); response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(request.url?.endsWith('/managed') ? { success: true, result: { enabled: false } } : { success: true, result: { domains: [{ enabled: false }] } }));
    });
    const client = await new EnvHostedBoardClientFactory(s3Env(s3.endpoint, 'r2', {
      WORKSPACEX_BOARD_R2_MANAGEMENT_ENDPOINT: management.endpoint, WORKSPACEX_BOARD_R2_ACCOUNT_ID: 'account', WORKSPACEX_BOARD_R2_MANAGEMENT_TOKEN: 'management-token',
    })).create({ provider: 's3-compatible', bucket: 'private-board', prefix: 'content' });
    await expect(client.inspectBucket()).resolves.toEqual({ access: 'private', versioning: 'unsupported', objectLock: 'unsupported' });
    await expect(new S3CompatibleBoardBlobStore(client, { requireObjectLock: false }).assertReady()).resolves.toBeUndefined();
    await expect(new S3CompatibleBoardBlobStore(client, { requireObjectLock: true }).assertReady()).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    expect(s3Calls).toEqual([]);
  });

  it.each(['managed-public', 'custom-public', 'invalid', 'timeout'])('fails closed for R2 management state: %s', async scenario => {
    const s3 = await listen((_request, response) => { response.statusCode = 500; response.end(); });
    const management = await listen(async (request, response) => {
      if (scenario === 'timeout') return new Promise<void>(() => undefined);
      response.setHeader('content-type', 'application/json');
      if (scenario === 'invalid') { response.end('{"success":true,"result":{}}'); return; }
      const managed = request.url?.endsWith('/managed');
      response.end(JSON.stringify(managed ? { success: true, result: { enabled: scenario === 'managed-public' } } : { success: true, result: { domains: [{ enabled: scenario === 'custom-public' }] } }));
    });
    const client = await new EnvHostedBoardClientFactory(s3Env(s3.endpoint, 'r2', { WORKSPACEX_BOARD_R2_MANAGEMENT_ENDPOINT: management.endpoint, WORKSPACEX_BOARD_R2_ACCOUNT_ID: 'account', WORKSPACEX_BOARD_R2_MANAGEMENT_TOKEN: 'token' }))
      .create({ provider: 's3-compatible', bucket: 'private-board', prefix: 'content' });
    await expect(client.inspectBucket()).rejects.toBeDefined();
  });

  it('uses an authenticated independent MinIO policy inspector and rejects unknown state', async () => {
    const s3 = await listen((_request, response) => { response.statusCode = 500; response.end(); });
    let valid = true;
    const inspector = await listen(async (request, response) => {
      expect(request.headers.authorization).toBe('Bearer inspector-token'); response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(valid ? { private: true, versioning: 'enabled', objectLock: true } : { private: 'yes' }));
    });
    const make = () => new EnvHostedBoardClientFactory(s3Env(s3.endpoint, 'minio', { WORKSPACEX_BOARD_MINIO_POLICY_INSPECTOR_ENDPOINT: inspector.endpoint, WORKSPACEX_BOARD_MINIO_POLICY_INSPECTOR_TOKEN: 'inspector-token' }))
      .create({ provider: 's3-compatible', bucket: 'private-board', prefix: 'content' });
    await expect((await make()).inspectBucket()).resolves.toEqual({ access: 'private', versioning: 'enabled', objectLock: 'enabled' });
    valid = false; await expect((await make()).inspectBucket()).rejects.toBeDefined();
  });

  it('requires an explicit supported S3 provider profile', async () => {
    await expect(new EnvHostedBoardClientFactory(s3Env('http://127.0.0.1:1', 'aws-s3', { WORKSPACEX_BOARD_S3_PROFILE: '' })).create({ provider: 's3-compatible', bucket: 'private-board', prefix: 'content' }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT', message: 'WORKSPACEX_BOARD_S3_PROFILE is required for hosted board storage' });
    await expect(new EnvHostedBoardClientFactory(s3Env('http://127.0.0.1:1', 'aws-s3', { WORKSPACEX_BOARD_S3_PROFILE: 'generic' })).create({ provider: 's3-compatible', bucket: 'private-board', prefix: 'content' }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT', message: 'WORKSPACEX_BOARD_S3_PROFILE must be aws-s3, minio, or r2' });
  });

  it('eagerly attributes selected governance-profile configuration without issuing HTTP', async () => {
    for (const [profile, expected] of [
      ['r2', 'WORKSPACEX_BOARD_R2_MANAGEMENT_ENDPOINT'],
      ['minio', 'WORKSPACEX_BOARD_MINIO_POLICY_INSPECTOR_ENDPOINT'],
    ] as const) {
      await expect(new EnvHostedBoardClientFactory(s3Env('http://127.0.0.1:1', profile)).create({ provider: 's3-compatible', bucket: 'private-board', prefix: 'content' }))
        .rejects.toMatchObject({ code: 'INVALID_INPUT', message: `${expected} must be a valid HTTPS URL for hosted board storage` });
    }
  });

  it('resolves exact remote key versions, decrypts v1 after rotation, and rejects changed v1 material', async () => {
    const keys = new Map([[1, Buffer.alloc(32, 1).toString('base64')]]), requests: unknown[] = [];
    const { endpoint } = await listen(async (request, response) => {
      const input = JSON.parse((await bodyOf(request)).toString('utf8')) as { version: number }; requests.push(input);
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ version: input.version, keyMaterial: keys.get(input.version) }));
    });
    const codec = new AesGcmBoardBlobCodec(new KmsBoardTenantKeyResolver(new HttpVersionedBoardMasterKeySource(new URL(endpoint), 'kms-test-token')));
    const old = await codec.encrypt({ tenantId: 'org-a', tenantKeyVersion: 1, plaintext: Buffer.from('historical') });
    keys.set(2, Buffer.alloc(32, 2).toString('base64')); await codec.encrypt({ tenantId: 'org-a', tenantKeyVersion: 2, plaintext: Buffer.from('current') });
    await expect(codec.decrypt({ ...old, tenantId: 'org-a', expectedPlainDigest: old.plainDigest })).resolves.toEqual(new Uint8Array(Buffer.from('historical')));
    keys.set(1, Buffer.alloc(32, 9).toString('base64'));
    await expect(codec.decrypt({ ...old, tenantId: 'org-a', expectedPlainDigest: old.plainDigest })).rejects.toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE' });
    expect(requests).toContainEqual({ tenantId: 'org-a', version: 1 });
  });
});
