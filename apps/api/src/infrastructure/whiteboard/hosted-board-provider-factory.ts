import OSS from 'ali-oss';
import {
  GetBucketAclCommand,
  GetBucketPolicyStatusCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  GetObjectLockConfigurationCommand,
  GetPublicAccessBlockCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { BoardBlobError } from '../../application/whiteboard/blob-ports';
import { ossCredentialSource } from '../storage/oss-sdk-client';
import type { VersionedBoardMasterKeySource } from './aes-gcm-board-blob-codec';
import { DEFAULT_BOARD_KEY_ID } from './aes-gcm-board-blob-codec';
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
  if (!value || /[\r\n\u0000]/.test(value)) throw new BoardBlobError('INVALID_INPUT', `${name} is required for hosted board storage`);
  return value;
};

const MAX_CONTROL_BODY_BYTES = 64 * 1024;

async function boundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_CONTROL_BODY_BYTES)) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('response too large');
  }
  if (!response.body) throw new Error('missing response body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_CONTROL_BODY_BYTES) throw new Error('response too large');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  return JSON.parse(Buffer.concat(chunks.map(value => Buffer.from(value)), size).toString('utf8'));
}

function endpoint(env: NodeJS.ProcessEnv, name: string): URL {
  let value: URL;
  try { value = new URL(required(env, name)); }
  catch { throw new BoardBlobError('INVALID_INPUT', `${name} must be a valid HTTPS URL for hosted board storage`); }
  const loopback = value.hostname === '127.0.0.1' || value.hostname === 'localhost' || value.hostname === '::1';
  if (value.username || value.password || value.search || value.hash || (value.protocol !== 'https:' && !(env.NODE_ENV === 'test' && loopback))) {
    throw new BoardBlobError('INVALID_INPUT', `${name} must be a valid HTTPS URL for hosted board storage`);
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
  getBucketPolicy(bucket: string): Promise<{ policy?: unknown }>;
};

class AliyunOssSdkBoardProtocol implements AliyunOssBoardProtocol {
  constructor(private readonly sdk: AliSdk) {}
  getBucketVersioning(bucket: string): Promise<{ versionStatus?: string }> { return this.sdk.getBucketVersioning(bucket); }
  async getBucketACL(bucket: string): Promise<{ acl?: string }> { return { acl: (await this.sdk.getBucketACL(bucket)).acl }; }
  async getBucketPolicy(bucket: string): Promise<{ policy: unknown | null }> {
    try { return { policy: (await this.sdk.getBucketPolicy(bucket)).policy ?? null }; }
    catch (error) {
      const code = (error as { code?: unknown; status?: unknown }).code;
      if (code === 'NoSuchBucketPolicy' || (error as { status?: unknown }).status === 404) return { policy: null };
      throw error;
    }
  }
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
  async delete(key: string, options?: { versionId?: string }): Promise<void> {
    const sdk = this.sdk as unknown as { delete(name: string, value?: { versionId?: string }): Promise<unknown> };
    await sdk.delete(key, options);
  }
}

/**
 * Credential acquisition belongs to readiness, not configuration parsing. In particular,
 * an ecs-role deployment must let the required-env probe enumerate/restore ROLE_NAME before
 * any metadata request occurs. The first real policy/object operation resolves credentials;
 * one rejected resolution is cached so concurrent readiness calls cannot fan out to IMDS.
 */
class LazyAliyunOssSdkBoardProtocol implements AliyunOssBoardProtocol {
  private protocol?: Promise<AliyunOssSdkBoardProtocol>;
  constructor(private readonly createSdk: () => Promise<AliSdk>) {}
  private configured(): Promise<AliyunOssSdkBoardProtocol> {
    return this.protocol ??= this.createSdk().then(sdk => new AliyunOssSdkBoardProtocol(sdk));
  }
  async getBucketVersioning(bucket: string) { return (await this.configured()).getBucketVersioning(bucket); }
  async getBucketACL(bucket: string) { return (await this.configured()).getBucketACL(bucket); }
  async getBucketObjectLock(bucket: string) { return (await this.configured()).getBucketObjectLock(bucket); }
  async getBucketPolicy(bucket: string) { return (await this.configured()).getBucketPolicy(bucket); }
  async put(key: string, bytes: Buffer, options: { headers: Record<string, string>; mime: string }) { return (await this.configured()).put(key, bytes, options); }
  async get(key: string) { return (await this.configured()).get(key); }
  async head(key: string) { return (await this.configured()).head(key); }
  async delete(key: string, options?: { versionId?: string }) { return (await this.configured()).delete(key, options); }
}

type S3Profile = 'aws-s3' | 'minio' | 'r2';
type Inspection = { private: boolean; versioning: 'Enabled' | 'Disabled' | 'Unsupported'; objectLock: boolean };

const publicAclUri = /\/groups\/global\/(?:AllUsers|AuthenticatedUsers)$/;
const isMissingObjectLock = (error: unknown): boolean => {
  const value = error as { name?: unknown; Code?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return value.name === 'ObjectLockConfigurationNotFoundError' || value.Code === 'ObjectLockConfigurationNotFoundError' || value.$metadata?.httpStatusCode === 404;
};

class OfficialS3BoardProtocol implements S3CompatibleBoardProtocol {
  private inspection?: Promise<Inspection>;

  constructor(
    private readonly sdk: S3Client,
    private readonly bucket: string,
    private readonly profile: S3Profile,
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  async getBucketVersioning(): Promise<{ status?: string }> { return { status: (await this.inspect()).versioning }; }
  async getBucketAccess(): Promise<{ private: boolean }> { return { private: (await this.inspect()).private }; }
  async getObjectLockConfiguration(): Promise<{ enabled: boolean }> { return { enabled: (await this.inspect()).objectLock }; }

  async putObject(input: { bucket: string; key: string; body: Uint8Array; contentType: string; ifNoneMatch: '*'; metadata: Record<string, string> }): Promise<void> {
    await this.sdk.send(new PutObjectCommand({ Bucket: input.bucket, Key: input.key, Body: input.body, ContentType: input.contentType, IfNoneMatch: input.ifNoneMatch, Metadata: input.metadata }));
  }

  async getObject(input: { bucket: string; key: string }): Promise<{ body: Uint8Array; metadata?: Record<string, string>; contentLength?: number } | null> {
    try {
      const result = await this.sdk.send(new GetObjectCommand({ Bucket: input.bucket, Key: input.key }));
      if (!result.Body) throw new Error('invalid S3 response');
      return { body: await result.Body.transformToByteArray(), metadata: result.Metadata, contentLength: result.ContentLength };
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
      throw error;
    }
  }

  async headObject(input: { bucket: string; key: string }): Promise<{ metadata?: Record<string, string>; contentLength?: number; versionId?: string } | null> {
    try {
      const result = await this.sdk.send(new HeadObjectCommand({ Bucket: input.bucket, Key: input.key }));
      return { metadata: result.Metadata, contentLength: result.ContentLength, versionId: result.VersionId };
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
      throw error;
    }
  }

  async deleteObject(input: { bucket: string; key: string; versionId?: string }): Promise<void> {
    await this.sdk.send(new DeleteObjectCommand({ Bucket: input.bucket, Key: input.key, ...(input.versionId ? { VersionId: input.versionId } : {}) }));
  }

  private inspect(): Promise<Inspection> {
    this.inspection ??= this.profile === 'aws-s3' ? this.inspectAws() : this.profile === 'r2' ? this.inspectR2() : this.inspectMinio();
    return this.inspection;
  }

  private async inspectAws(): Promise<Inspection> {
    const [versioning, block, policy, acl, objectLock] = await Promise.all([
      this.sdk.send(new GetBucketVersioningCommand({ Bucket: this.bucket })),
      this.sdk.send(new GetPublicAccessBlockCommand({ Bucket: this.bucket })),
      this.sdk.send(new GetBucketPolicyStatusCommand({ Bucket: this.bucket })),
      this.sdk.send(new GetBucketAclCommand({ Bucket: this.bucket })),
      this.sdk.send(new GetObjectLockConfigurationCommand({ Bucket: this.bucket })).catch(error => {
        if (isMissingObjectLock(error)) return false as const;
        throw error;
      }),
    ]);
    const pab = block.PublicAccessBlockConfiguration;
    if (!pab || pab.BlockPublicAcls !== true || pab.IgnorePublicAcls !== true || pab.BlockPublicPolicy !== true || pab.RestrictPublicBuckets !== true) {
      throw new Error('S3 public access block is incomplete');
    }
    if (policy.PolicyStatus?.IsPublic !== false || !Array.isArray(acl.Grants)) throw new Error('S3 bucket privacy is unknown');
    const publicGrant = acl.Grants.some(grant => grant.Grantee?.URI ? publicAclUri.test(grant.Grantee.URI) : false);
    return {
      private: !publicGrant,
      versioning: versioning.Status === 'Enabled' ? 'Enabled' : 'Disabled',
      objectLock: objectLock !== false && objectLock.ObjectLockConfiguration?.ObjectLockEnabled === 'Enabled',
    };
  }

  private async managementJson(url: URL, token: string): Promise<unknown> {
    const timeoutMs = this.env.NODE_ENV === 'test' ? 250 : 5_000;
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error('storage policy service unavailable');
    }
    return boundedJson(response);
  }

  private async inspectR2(): Promise<Inspection> {
    const base = endpoint(this.env, 'WORKSPACEX_BOARD_R2_MANAGEMENT_ENDPOINT');
    const account = encodeURIComponent(required(this.env, 'WORKSPACEX_BOARD_R2_ACCOUNT_ID'));
    const token = required(this.env, 'WORKSPACEX_BOARD_R2_MANAGEMENT_TOKEN');
    const bucket = encodeURIComponent(this.bucket);
    const managedUrl = new URL(`accounts/${account}/r2/buckets/${bucket}/domains/managed`, `${base.toString().replace(/\/?$/, '/')}`);
    const customUrl = new URL(`accounts/${account}/r2/buckets/${bucket}/domains/custom`, `${base.toString().replace(/\/?$/, '/')}`);
    const [managedValue, customValue] = await Promise.all([this.managementJson(managedUrl, token), this.managementJson(customUrl, token)]);
    const managed = managedValue as { success?: unknown; result?: { enabled?: unknown } };
    const custom = customValue as { success?: unknown; result?: { domains?: Array<{ enabled?: unknown }> } };
    if (managed.success !== true || managed.result?.enabled !== false || custom.success !== true || !Array.isArray(custom.result?.domains)) {
      throw new Error('R2 public access state is unknown');
    }
    if (custom.result.domains.some(domain => typeof domain.enabled !== 'boolean' || domain.enabled)) throw new Error('R2 custom domain is public or unknown');
    return { private: true, versioning: 'Unsupported', objectLock: false };
  }

  private async inspectMinio(): Promise<Inspection> {
    const base = endpoint(this.env, 'WORKSPACEX_BOARD_MINIO_POLICY_INSPECTOR_ENDPOINT');
    const token = required(this.env, 'WORKSPACEX_BOARD_MINIO_POLICY_INSPECTOR_TOKEN');
    const url = new URL(`buckets/${encodeURIComponent(this.bucket)}/policy`, `${base.toString().replace(/\/?$/, '/')}`);
    const value = await this.managementJson(url, token) as { private?: unknown; versioning?: unknown; objectLock?: unknown };
    if (value.private !== true || !['enabled', 'disabled'].includes(String(value.versioning)) || typeof value.objectLock !== 'boolean') {
      throw new Error('MinIO policy state is unknown');
    }
    return { private: true, versioning: value.versioning === 'enabled' ? 'Enabled' : 'Disabled', objectLock: value.objectLock };
  }
}

export class EnvHostedBoardClientFactory implements HostedBoardClientFactory {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async create(input: { provider: 'aliyun-oss' | 's3-compatible'; bucket: string; prefix: string }) {
    if (input.provider === 'aliyun-oss') {
      const url = endpoint(this.env, 'WORKSPACEX_BOARD_OSS_ENDPOINT');
      const region = required(this.env, 'WORKSPACEX_BOARD_OSS_REGION');
      const authMode = this.env.WORKSPACEX_BOARD_OSS_AUTH_MODE?.trim() || (this.env.NODE_ENV === 'production' ? '' : 'ecs-role');
      if (authMode !== 'ecs-role' && authMode !== 'environment') {
        throw new BoardBlobError('INVALID_INPUT', 'WORKSPACEX_BOARD_OSS_AUTH_MODE must be ecs-role or environment');
      }
      if (authMode === 'environment') {
        required(this.env, 'WORKSPACEX_BOARD_OSS_ACCESS_KEY_ID');
        required(this.env, 'WORKSPACEX_BOARD_OSS_ACCESS_KEY_SECRET');
      } else {
        required(this.env, 'WORKSPACEX_BOARD_OSS_ROLE_NAME');
      }
      const source = ossCredentialSource({ region, bucket: input.bucket, endpoint: url.toString(), prefix: input.prefix, authMode, roleName: this.env.WORKSPACEX_BOARD_OSS_ROLE_NAME }, {
        ...this.env,
        OSS_ACCESS_KEY_ID: this.env.WORKSPACEX_BOARD_OSS_ACCESS_KEY_ID,
        OSS_ACCESS_KEY_SECRET: this.env.WORKSPACEX_BOARD_OSS_ACCESS_KEY_SECRET,
        OSS_SECURITY_TOKEN: this.env.WORKSPACEX_BOARD_OSS_SECURITY_TOKEN,
      });
      const protocol = new LazyAliyunOssSdkBoardProtocol(async () => {
        let credentials;
        try { credentials = await source(); }
        catch { throw new BoardBlobError('STORAGE_UNAVAILABLE', 'hosted board storage credentials are unavailable'); }
        return new OSS({ ...credentials, bucket: input.bucket, region: `oss-${region}`, endpoint: url.toString(), secure: url.protocol === 'https:', authorizationV4: true, timeout: 10_000, refreshSTSToken: source, refreshSTSTokenInterval: 0 }) as AliSdk;
      });
      return new AliyunOssBoardBlobClient(protocol, input.bucket, input.prefix);
    }

    const url = endpoint(this.env, 'WORKSPACEX_BOARD_S3_ENDPOINT');
    const profile = required(this.env, 'WORKSPACEX_BOARD_S3_PROFILE') as S3Profile;
    if (!['aws-s3', 'minio', 'r2'].includes(profile)) {
      throw new BoardBlobError('INVALID_INPUT', 'WORKSPACEX_BOARD_S3_PROFILE must be aws-s3, minio, or r2');
    }
    const credentials = {
      accessKeyId: required(this.env, 'WORKSPACEX_BOARD_S3_ACCESS_KEY_ID'),
      secretAccessKey: required(this.env, 'WORKSPACEX_BOARD_S3_SECRET_ACCESS_KEY'),
      sessionToken: this.env.WORKSPACEX_BOARD_S3_SESSION_TOKEN?.trim() || undefined,
    };
    const region = required(this.env, 'WORKSPACEX_BOARD_S3_REGION');
    // Validate the selected governance plane before constructing a client. Readiness still
    // performs the real HTTP checks; this eager pass only guarantees that every conditional
    // production input is attributable by the startup required-env probe.
    if (profile === 'r2') {
      endpoint(this.env, 'WORKSPACEX_BOARD_R2_MANAGEMENT_ENDPOINT');
      required(this.env, 'WORKSPACEX_BOARD_R2_ACCOUNT_ID');
      required(this.env, 'WORKSPACEX_BOARD_R2_MANAGEMENT_TOKEN');
    } else if (profile === 'minio') {
      endpoint(this.env, 'WORKSPACEX_BOARD_MINIO_POLICY_INSPECTOR_ENDPOINT');
      required(this.env, 'WORKSPACEX_BOARD_MINIO_POLICY_INSPECTOR_TOKEN');
    }
    const sdk = new S3Client({ endpoint: url.toString(), region, forcePathStyle: true, credentials });
    const protocol = new OfficialS3BoardProtocol(sdk, input.bucket, profile, this.env);
    return new S3CompatibleBoardBlobClient(protocol, input.bucket, input.prefix, profile);
  }
}

/** Exact-version secret-manager/KMS HTTP boundary. The endpoint returns JSON { version, keyMaterial }. */
export class HttpVersionedBoardMasterKeySource implements VersionedBoardMasterKeySource {
  constructor(private readonly url: URL, private readonly token: string, readonly currentKeyId = DEFAULT_BOARD_KEY_ID) {}
  async resolveVersion(input: { tenantId: string; keyId: string; version: number }): Promise<{ keyId: string; version: number; keyMaterial: Uint8Array }> {
    try {
      if (input.keyId !== this.currentKeyId) throw new Error('invalid key identity');
      const response = await fetch(this.url, { method: 'POST', headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(5000), redirect: 'error' });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error('unavailable');
      }
      const value = await boundedJson(response) as { keyId?: unknown; version?: unknown; keyMaterial?: unknown };
      if (value.keyId !== input.keyId || value.version !== input.version || typeof value.keyMaterial !== 'string') throw new Error('invalid');
      const keyMaterial = Buffer.from(value.keyMaterial, 'base64');
      if (keyMaterial.byteLength !== 32 || keyMaterial.toString('base64').replace(/=+$/, '') !== value.keyMaterial.replace(/=+$/, '')) throw new Error('invalid');
      const result = new Uint8Array(keyMaterial);
      keyMaterial.fill(0);
      return { keyId: input.keyId, version: input.version, keyMaterial: result };
    } catch { throw new BoardBlobError('ENCRYPTION_UNAVAILABLE', 'versioned board key service is unavailable'); }
  }
}

export function versionedBoardKeySourceFromEnv(env: NodeJS.ProcessEnv = process.env): VersionedBoardMasterKeySource | undefined {
  if (!env.WORKSPACEX_BOARD_KMS_ENDPOINT && !env.WORKSPACEX_BOARD_KMS_TOKEN) {
    return env.WORKSPACEX_BOARD_KEY_DIRECTORY ? new FileBoardMasterKeySource(env.WORKSPACEX_BOARD_KEY_DIRECTORY, env.WORKSPACEX_BOARD_KMS_KEY_ID?.trim() || DEFAULT_BOARD_KEY_ID) : undefined;
  }
  const url = endpoint(env, 'WORKSPACEX_BOARD_KMS_ENDPOINT');
  return new HttpVersionedBoardMasterKeySource(url, required(env, 'WORKSPACEX_BOARD_KMS_TOKEN'), required(env, 'WORKSPACEX_BOARD_KMS_KEY_ID'));
}
