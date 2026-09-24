import { createHash, createHmac } from 'node:crypto';
import OSS from 'ali-oss';
import { BoardBlobError } from '../../application/whiteboard/blob-ports';
import { ossCredentialSource } from '../storage/oss-sdk-client';
import type { VersionedBoardMasterKeySource } from './aes-gcm-board-blob-codec';
import type { HostedBoardClientFactory } from './board-storage-selection';
import { FileBoardMasterKeySource } from './file-board-master-key-source';
import {
  AliyunOssBoardBlobClient,
  S3CompatibleBoardBlobClient,
  type AliyunOssBoardProtocol,
  type S3CompatibleBoardProtocol,
} from './hosted-board-blob-clients';

const required = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name]?.trim();
  if (!value || /[\r\n\u0000]/.test(value)) throw new BoardBlobError('STORAGE_UNAVAILABLE', 'hosted board storage configuration is incomplete');
  return value;
};

function endpoint(env: NodeJS.ProcessEnv, name: string): URL {
  let value: URL;
  try { value = new URL(required(env, name)); }
  catch { throw new BoardBlobError('STORAGE_UNAVAILABLE', 'hosted board storage endpoint is invalid'); }
  const loopback = value.hostname === '127.0.0.1' || value.hostname === 'localhost' || value.hostname === '::1';
  if (value.username || value.password || value.search || value.hash || (value.protocol !== 'https:' && !(env.NODE_ENV === 'test' && loopback))) {
    throw new BoardBlobError('STORAGE_UNAVAILABLE', 'hosted board storage endpoint is invalid');
  }
  return value;
}

function headersOf(headers: object): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string' || typeof value === 'number') normalized[name.toLowerCase()] = String(value);
  }
  return normalized;
}

type AliSdk = OSS & {
  getBucketVersioning(bucket: string): Promise<{ versionStatus?: string }>;
  getBucketWorm(bucket: string): Promise<{ wormState?: string }>;
};

class AliyunOssSdkBoardProtocol implements AliyunOssBoardProtocol {
  constructor(private readonly sdk: AliSdk) {}
  getBucketVersioning(bucket: string): Promise<{ versionStatus?: string }> { return this.sdk.getBucketVersioning(bucket); }
  async getBucketACL(bucket: string): Promise<{ acl?: string }> { return { acl: (await this.sdk.getBucketACL(bucket)).acl }; }
  async getBucketObjectLock(bucket: string): Promise<{ status?: string }> {
    try {
      const result = await this.sdk.getBucketWorm(bucket);
      return { status: ['locked', 'inprogress'].includes(result.wormState?.toLowerCase() ?? '') ? 'Enabled' : 'Disabled' };
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code === 'NoSuchWORMConfiguration' || code === '404') return { status: 'Disabled' };
      throw error;
    }
  }
  async put(key: string, bytes: Buffer, options: { headers: Record<string, string>; mime: string }): Promise<void> { await this.sdk.put(key, bytes, options); }
  async get(key: string): Promise<{ content: Buffer; headers: Record<string, string> }> {
    const result = await this.sdk.get(key);
    if (!Buffer.isBuffer(result.content)) throw new Error('invalid OSS response');
    return { content: result.content, headers: headersOf(result.res.headers) };
  }
  async head(key: string): Promise<{ headers: Record<string, string> }> { return { headers: headersOf((await this.sdk.head(key)).res.headers) }; }
}

type S3Credentials = { accessKeyId: string; secretAccessKey: string; sessionToken?: string };

const sha256Hex = (value: Uint8Array | string): string => createHash('sha256').update(value).digest('hex');
const hmac = (key: Uint8Array | string, value: string): Buffer => createHmac('sha256', key).update(value).digest();
const xmlValue = (xml: string, name: string): string | undefined => {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`, 'i'));
  return match?.[1]?.trim();
};
const encodePath = (path: string): string => path.split('/').map(part => encodeURIComponent(part).replace(/%7E/g, '~')).join('/');

class S3SigV4BoardProtocol implements S3CompatibleBoardProtocol {
  constructor(
    private readonly base: URL,
    private readonly region: string,
    private readonly credentials: S3Credentials,
    private readonly privateAccessConfirmed: boolean,
  ) {}

  async getBucketVersioning(bucket: string): Promise<{ status?: string }> {
    return { status: xmlValue(await this.request('GET', bucket, '', 'versioning'), 'Status') };
  }
  async getBucketAccess(bucket: string): Promise<{ private: boolean }> {
    const acl = await this.request('GET', bucket, '', 'acl');
    const globallyGranted = /<URI>\s*http:\/\/acs\.amazonaws\.com\/groups\/global\/(?:AllUsers|AuthenticatedUsers)\s*<\/URI>/i.test(acl);
    return { private: this.privateAccessConfirmed && !globallyGranted };
  }
  async getObjectLockConfiguration(bucket: string): Promise<{ enabled: boolean }> {
    try { return { enabled: xmlValue(await this.request('GET', bucket, '', 'object-lock'), 'ObjectLockEnabled')?.toLowerCase() === 'enabled' }; }
    catch (error) {
      const value = error as { status?: unknown; code?: unknown; name?: unknown };
      if (value.status === 404 || value.status === 501 || value.code === 'NotImplemented' || value.name === 'NotImplemented') return { enabled: false };
      throw error;
    }
  }
  async putObject(input: { bucket: string; key: string; body: Uint8Array; contentType: string; ifNoneMatch: '*'; metadata: Record<string, string> }): Promise<void> {
    const metadata = Object.fromEntries(Object.entries(input.metadata).map(([key, value]) => [`x-amz-meta-${key}`, value]));
    await this.request('PUT', input.bucket, input.key, '', Buffer.from(input.body), { 'content-type': input.contentType, 'if-none-match': input.ifNoneMatch, ...metadata });
  }
  async getObject(input: { bucket: string; key: string }): Promise<{ body: Uint8Array; metadata?: Record<string, string>; contentLength?: number } | null> {
    const result = await this.requestBytes('GET', input.bucket, input.key);
    if (!result) return null;
    return { body: result.body, metadata: this.metadata(result.headers), contentLength: Number(result.headers.get('content-length') ?? result.body.byteLength) };
  }
  async headObject(input: { bucket: string; key: string }): Promise<{ metadata?: Record<string, string>; contentLength?: number } | null> {
    const result = await this.requestBytes('HEAD', input.bucket, input.key);
    if (!result) return null;
    return { metadata: this.metadata(result.headers), contentLength: Number(result.headers.get('content-length') ?? 0) };
  }

  private metadata(headers: Headers): Record<string, string> {
    const values: Record<string, string> = {};
    headers.forEach((value, name) => { if (name.startsWith('x-amz-meta-')) values[name.slice(11)] = value; });
    return values;
  }

  private async request(method: string, bucket: string, key: string, query = '', body = new Uint8Array(), extra: Record<string, string> = {}): Promise<string> {
    const result = await this.requestBytes(method, bucket, key, query, body, extra);
    if (!result) throw Object.assign(new Error('not found'), { status: 404, name: 'NotFound' });
    return Buffer.from(result.body).toString('utf8');
  }

  private async requestBytes(method: string, bucket: string, key: string, query = '', body = new Uint8Array(), extra: Record<string, string> = {}): Promise<{ body: Uint8Array; headers: Headers } | null> {
    const now = new Date(), amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''), date = amzDate.slice(0, 8);
    const root = this.base.pathname.replace(/\/$/, '');
    const canonicalUri = `${root}/${encodePath(bucket)}${key ? `/${encodePath(key)}` : ''}` || '/';
    const host = this.base.host;
    const payloadHash = sha256Hex(body);
    const signedHeaders: Record<string, string> = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, ...extra };
    if (this.credentials.sessionToken) signedHeaders['x-amz-security-token'] = this.credentials.sessionToken;
    const names = Object.keys(signedHeaders).map(name => name.toLowerCase()).sort();
    const canonicalHeaders = names.map(name => `${name}:${signedHeaders[name]!.trim().replace(/\s+/g, ' ')}`).join('\n') + '\n';
    const canonicalQuery = query ? `${encodeURIComponent(query)}=` : '';
    const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, names.join(';'), payloadHash].join('\n');
    const scope = `${date}/${this.region}/s3/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonicalRequest)}`;
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${this.credentials.secretAccessKey}`, date), this.region), 's3'), 'aws4_request');
    signedHeaders.authorization = `AWS4-HMAC-SHA256 Credential=${this.credentials.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${hmac(signingKey, stringToSign).toString('hex')}`;
    const url = new URL(canonicalUri, this.base); if (query) url.searchParams.set(query, '');
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, { method, headers: signedHeaders, body: method === 'PUT' ? body : undefined, signal: controller.signal });
      if (response.status === 404) return null;
      const responseBody = new Uint8Array(await response.arrayBuffer());
      if (!response.ok) {
        const code = xmlValue(Buffer.from(responseBody).toString('utf8'), 'Code') ?? String(response.status);
        throw Object.assign(new Error('S3 request failed'), { status: response.status, name: code, code });
      }
      return { body: responseBody, headers: response.headers };
    } finally { clearTimeout(timeout); }
  }
}

export class EnvHostedBoardClientFactory implements HostedBoardClientFactory {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async create(input: { provider: 'aliyun-oss' | 's3-compatible'; bucket: string; prefix: string }) {
    if (input.provider === 'aliyun-oss') {
      const url = endpoint(this.env, 'WORKSPACEX_BOARD_OSS_ENDPOINT');
      const region = required(this.env, 'WORKSPACEX_BOARD_OSS_REGION');
      const authMode = this.env.WORKSPACEX_BOARD_OSS_AUTH_MODE?.trim() || 'ecs-role';
      if (authMode !== 'ecs-role' && authMode !== 'environment') throw new BoardBlobError('STORAGE_UNAVAILABLE', 'hosted board storage authentication is invalid');
      const source = ossCredentialSource({ region, bucket: input.bucket, endpoint: url.toString(), prefix: input.prefix, authMode, roleName: this.env.WORKSPACEX_BOARD_OSS_ROLE_NAME }, {
        ...this.env,
        OSS_ACCESS_KEY_ID: this.env.WORKSPACEX_BOARD_OSS_ACCESS_KEY_ID,
        OSS_ACCESS_KEY_SECRET: this.env.WORKSPACEX_BOARD_OSS_ACCESS_KEY_SECRET,
        OSS_SECURITY_TOKEN: this.env.WORKSPACEX_BOARD_OSS_SECURITY_TOKEN,
      });
      let credentials;
      try { credentials = await source(); } catch { throw new BoardBlobError('STORAGE_UNAVAILABLE', 'hosted board storage credentials are unavailable'); }
      const sdk = new OSS({ ...credentials, bucket: input.bucket, region: `oss-${region}`, endpoint: url.toString(), secure: url.protocol === 'https:', authorizationV4: true, timeout: 10_000, refreshSTSToken: source, refreshSTSTokenInterval: 0 }) as AliSdk;
      return new AliyunOssBoardBlobClient(new AliyunOssSdkBoardProtocol(sdk), input.bucket, input.prefix);
    }
    const url = endpoint(this.env, 'WORKSPACEX_BOARD_S3_ENDPOINT');
    const region = required(this.env, 'WORKSPACEX_BOARD_S3_REGION');
    const accessKeyId = required(this.env, 'WORKSPACEX_BOARD_S3_ACCESS_KEY_ID');
    const secretAccessKey = required(this.env, 'WORKSPACEX_BOARD_S3_SECRET_ACCESS_KEY');
    if (this.env.WORKSPACEX_BOARD_S3_PRIVATE_ACCESS_CONFIRMED !== 'true') throw new BoardBlobError('STORAGE_UNAVAILABLE', 'private bucket policy confirmation is required');
    const protocol = new S3SigV4BoardProtocol(url, region, { accessKeyId, secretAccessKey, sessionToken: this.env.WORKSPACEX_BOARD_S3_SESSION_TOKEN }, true);
    return new S3CompatibleBoardBlobClient(protocol, input.bucket, input.prefix);
  }
}

/** Exact-version secret-manager/KMS HTTP boundary. The endpoint returns JSON { version, keyMaterial }. */
export class HttpVersionedBoardMasterKeySource implements VersionedBoardMasterKeySource {
  constructor(private readonly url: URL, private readonly token: string) {}
  async resolveVersion(input: { tenantId: string; version: number }): Promise<{ version: number; keyMaterial: Uint8Array }> {
    try {
      const response = await fetch(this.url, { method: 'POST', headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('unavailable');
      const value = await response.json() as { version?: unknown; keyMaterial?: unknown };
      if (value.version !== input.version || typeof value.keyMaterial !== 'string') throw new Error('invalid');
      const keyMaterial = Buffer.from(value.keyMaterial, 'base64');
      if (keyMaterial.byteLength !== 32 || keyMaterial.toString('base64').replace(/=+$/, '') !== value.keyMaterial.replace(/=+$/, '')) throw new Error('invalid');
      return { version: input.version, keyMaterial: new Uint8Array(keyMaterial) };
    } catch { throw new BoardBlobError('ENCRYPTION_UNAVAILABLE', 'versioned board key service is unavailable'); }
  }
}

export function versionedBoardKeySourceFromEnv(env: NodeJS.ProcessEnv = process.env): VersionedBoardMasterKeySource | undefined {
  if (!env.WORKSPACEX_BOARD_KMS_ENDPOINT && !env.WORKSPACEX_BOARD_KMS_TOKEN) {
    return env.WORKSPACEX_BOARD_KEY_DIRECTORY ? new FileBoardMasterKeySource(env.WORKSPACEX_BOARD_KEY_DIRECTORY) : undefined;
  }
  const url = endpoint(env, 'WORKSPACEX_BOARD_KMS_ENDPOINT');
  return new HttpVersionedBoardMasterKeySource(url, required(env, 'WORKSPACEX_BOARD_KMS_TOKEN'));
}
