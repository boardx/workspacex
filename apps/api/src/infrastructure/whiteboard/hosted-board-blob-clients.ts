import type { HostedBoardBlobClient, HostedBoardBlobObject, HostedBoardBucketPolicy, HostedBoardPutResult } from './hosted-board-blob-store';

type ObjectMetadata = { cipherDigest: string; sizeBytes: number };

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  for (const field of ['code', 'name', 'Code']) {
    const value = (error as Record<string, unknown>)[field];
    if (typeof value === 'string') return value;
  }
  const status = (error as { $metadata?: { httpStatusCode?: unknown }; status?: unknown }).$metadata?.httpStatusCode
    ?? (error as { status?: unknown }).status;
  return typeof status === 'number' ? String(status) : undefined;
}

function namespaced(prefix: string, key: string): string {
  if (!prefix || prefix.startsWith('/') || prefix.includes('..') || /[\r\n\u0000]/.test(prefix)) throw new Error('invalid Board prefix');
  if (!key || key.startsWith('/') || /[\r\n\u0000]/.test(key)) throw new Error('invalid Board key');
  return `${prefix.replace(/\/$/, '')}/${key}`;
}

function descriptor(metadata: Record<string, string | undefined>, length: number | undefined): Omit<HostedBoardBlobObject, 'bytes'> {
  const cipherDigest = metadata['cipher-digest'] ?? metadata['cipherdigest'] ?? metadata['x-oss-meta-cipher-digest'];
  const recordedSize = metadata['size-bytes'] ?? metadata['sizebytes'] ?? metadata['x-oss-meta-size-bytes'];
  const parsed = recordedSize === undefined ? length : Number(recordedSize);
  return { cipherDigest, sizeBytes: parsed };
}

function policyGrantsPublic(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid bucket policy');
  const statement = (value as { Statement?: unknown }).Statement;
  const statements = Array.isArray(statement) ? statement : statement && typeof statement === 'object' ? [statement] : [];
  return statements.some(item => {
    if (!item || typeof item !== 'object') throw new Error('invalid bucket policy');
    const record = item as { Effect?: unknown; Principal?: unknown };
    if (record.Effect !== 'Allow') return false;
    return record.Principal === '*' || !!record.Principal && typeof record.Principal === 'object'
      && Object.values(record.Principal as Record<string, unknown>).some(principal => principal === '*' || Array.isArray(principal) && principal.includes('*'));
  });
}

export interface AliyunOssBoardProtocol {
  getBucketVersioning(bucket: string): Promise<{ versionStatus?: string }>;
  getBucketACL(bucket: string): Promise<{ acl?: string }>;
  getBucketObjectLock(bucket: string): Promise<{ status?: string }>;
  getBucketPolicy(bucket: string): Promise<{ policy: unknown | null }>;
  put(key: string, bytes: Buffer, options: { headers: Record<string, string>; mime: string }): Promise<void>;
  get(key: string): Promise<{ content: Buffer; headers: Record<string, string | undefined> }>;
  head(key: string): Promise<{ headers: Record<string, string | undefined> }>;
}

export class AliyunOssBoardBlobClient implements HostedBoardBlobClient {
  readonly provider = 'aliyun-oss' as const;
  constructor(private readonly client: AliyunOssBoardProtocol, private readonly bucket: string, private readonly prefix: string) {}

  async inspectBucket(): Promise<HostedBoardBucketPolicy> {
    const [version, acl, lock, policy] = await Promise.all([
      this.client.getBucketVersioning(this.bucket),
      this.client.getBucketACL(this.bucket),
      this.client.getBucketObjectLock(this.bucket),
      this.client.getBucketPolicy(this.bucket),
    ]);
    const publicPolicy = policy.policy !== null && policyGrantsPublic(policy.policy);
    return {
      access: acl.acl === 'private' && !publicPolicy ? 'private' : acl.acl && policy.policy !== undefined ? 'public' : 'unknown',
      versioning: version.versionStatus?.toLowerCase() === 'enabled' ? 'enabled' : version.versionStatus ? 'disabled' : 'unknown',
      objectLock: lock.status?.toLowerCase() === 'enabled' ? 'enabled' : lock.status ? 'disabled' : 'unknown',
    };
  }

  async putIfAbsent(input: { key: string; bytes: Uint8Array; contentType: 'application/octet-stream'; metadata: ObjectMetadata }): Promise<HostedBoardPutResult> {
    try {
      await this.client.put(namespaced(this.prefix, input.key), Buffer.from(input.bytes), {
        mime: input.contentType,
        headers: {
          'x-oss-forbid-overwrite': 'true',
          'x-oss-meta-cipher-digest': input.metadata.cipherDigest,
          'x-oss-meta-size-bytes': String(input.metadata.sizeBytes),
        },
      });
      return 'created';
    } catch (error) {
      if (['FileAlreadyExists', '409', '412', 'PreconditionFailed'].includes(errorCode(error) ?? '')) return 'already-exists';
      throw new Error('OSS Board request failed');
    }
  }

  async get(key: string): Promise<HostedBoardBlobObject | null> {
    try {
      const result = await this.client.get(namespaced(this.prefix, key));
      return { bytes: new Uint8Array(result.content), ...descriptor(result.headers, result.content.byteLength) };
    } catch (error) {
      if (['NoSuchKey', '404', 'NotFound'].includes(errorCode(error) ?? '')) return null;
      throw new Error('OSS Board request failed');
    }
  }

  async head(key: string): Promise<Omit<HostedBoardBlobObject, 'bytes'> | null> {
    try {
      const result = await this.client.head(namespaced(this.prefix, key));
      const length = result.headers['content-length'];
      return descriptor(result.headers, length === undefined ? undefined : Number(length));
    } catch (error) {
      if (['NoSuchKey', '404', 'NotFound'].includes(errorCode(error) ?? '')) return null;
      throw new Error('OSS Board request failed');
    }
  }
}

export interface S3CompatibleBoardProtocol {
  getBucketVersioning(bucket: string): Promise<{ status?: string }>;
  getBucketAccess(bucket: string): Promise<{ private: boolean }>;
  getObjectLockConfiguration(bucket: string): Promise<{ enabled: boolean }>;
  putObject(input: { bucket: string; key: string; body: Uint8Array; contentType: string; ifNoneMatch: '*'; metadata: Record<string, string> }): Promise<void>;
  getObject(input: { bucket: string; key: string }): Promise<{ body: Uint8Array; metadata?: Record<string, string>; contentLength?: number } | null>;
  headObject(input: { bucket: string; key: string }): Promise<{ metadata?: Record<string, string>; contentLength?: number } | null>;
}

export class S3CompatibleBoardBlobClient implements HostedBoardBlobClient {
  readonly provider = 's3-compatible' as const;
  constructor(private readonly client: S3CompatibleBoardProtocol, private readonly bucket: string, private readonly prefix: string, readonly profile?: 'aws-s3' | 'minio' | 'r2') {}

  async inspectBucket(): Promise<HostedBoardBucketPolicy> {
    const [version, access, lock] = await Promise.all([
      this.client.getBucketVersioning(this.bucket),
      this.client.getBucketAccess(this.bucket),
      this.client.getObjectLockConfiguration(this.bucket),
    ]);
    return {
      access: access.private ? 'private' : 'public',
      versioning: version.status?.toLowerCase() === 'enabled' ? 'enabled' : version.status?.toLowerCase() === 'unsupported' ? 'unsupported' : version.status ? 'disabled' : 'unknown',
      objectLock: lock.enabled ? 'enabled' : this.profile === 'r2' ? 'unsupported' : 'disabled',
    };
  }

  async putIfAbsent(input: { key: string; bytes: Uint8Array; contentType: 'application/octet-stream'; metadata: ObjectMetadata }): Promise<HostedBoardPutResult> {
    try {
      await this.client.putObject({
        bucket: this.bucket,
        key: namespaced(this.prefix, input.key),
        body: new Uint8Array(input.bytes),
        contentType: input.contentType,
        ifNoneMatch: '*',
        metadata: { 'cipher-digest': input.metadata.cipherDigest, 'size-bytes': String(input.metadata.sizeBytes) },
      });
      return 'created';
    } catch (error) {
      if (['409', '412', 'PreconditionFailed', 'ConditionalRequestConflict'].includes(errorCode(error) ?? '')) return 'already-exists';
      throw new Error('S3-compatible Board request failed');
    }
  }

  async get(key: string): Promise<HostedBoardBlobObject | null> {
    try {
      const result = await this.client.getObject({ bucket: this.bucket, key: namespaced(this.prefix, key) });
      return result ? { bytes: new Uint8Array(result.body), ...descriptor(result.metadata ?? {}, result.contentLength) } : null;
    } catch (error) {
      if (['NoSuchKey', '404', 'NotFound'].includes(errorCode(error) ?? '')) return null;
      throw new Error('S3-compatible Board request failed');
    }
  }

  async head(key: string): Promise<Omit<HostedBoardBlobObject, 'bytes'> | null> {
    try {
      const result = await this.client.headObject({ bucket: this.bucket, key: namespaced(this.prefix, key) });
      return result ? descriptor(result.metadata ?? {}, result.contentLength) : null;
    } catch (error) {
      if (['NoSuchKey', '404', 'NotFound'].includes(errorCode(error) ?? '')) return null;
      throw new Error('S3-compatible Board request failed');
    }
  }
}
