import { createHash } from "node:crypto";
import { ObjectExistsError, ObjectStoreUnavailableError, type ObjectStore } from "../../application/artifact/ports";
import type { PhysicalPurgePort } from "../../application/files/physical-delete-ports";

export interface OssClientPort {
  getBucketVersioning(bucket: string): Promise<{ versionStatus?: string }>;
  getBucketACL(bucket: string): Promise<{ acl: string }>;
  put(key: string, bytes: Buffer, options: { mime: string; headers: Record<string, string> }): Promise<void>;
  get(key: string): Promise<{ content: Buffer; headers: Record<string, string> }>;
  head(key: string): Promise<{ headers: Record<string, string> }>;
  delete(key: string): Promise<void>;
}

const unavailable = () => new ObjectStoreUnavailableError("OSS unavailable");
const failureCode = (error: unknown) => {
  if (typeof error !== "object" || error === null) return undefined;
  return "code" in error && typeof error.code === "string" ? error.code : undefined;
};
const missing = (error: unknown) => failureCode(error) === "NoSuchKey";
const validSegments = (value: string) => value.length > 0 && !/[\\\u0000-\u001f\u007f]/.test(value)
  && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");

function namespace(prefix: string) {
  const normalized = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(normalized)) throw unavailable();
  return (key: string) => {
    if (!validSegments(key)) throw unavailable();
    const objectKey = `${normalized}/${key}`;
    if (Buffer.byteLength(objectKey, "utf8") > 1023) throw unavailable();
    return objectKey;
  };
}

/** The first cloud release supports only private, never-versioned buckets.
 * Enabling versioning invalidates forbid-overwrite; fail closed instead of claiming
 * write-once or deleting just the current version. Never change bucket configuration here.
 */
async function assertCompatible(client: OssClientPort, bucket: string) {
  const [version, access] = await Promise.all([client.getBucketVersioning(bucket), client.getBucketACL(bucket)]);
  if ((version.versionStatus !== undefined && version.versionStatus !== "") || access.acl !== "private") throw unavailable();
}

export class OssObjectStore implements ObjectStore {
  private readonly key: (key: string) => string;
  constructor(private readonly client: OssClientPort, private readonly bucket: string, prefix: string) {
    this.key = namespace(prefix);
  }
  async assertReady(): Promise<void> {
    try { await assertCompatible(this.client, this.bucket); } catch { throw unavailable(); }
  }
  async putOnce(key: string, bytes: Uint8Array, mime: string): Promise<void> {
    const objectKey = this.key(key);
    if (!mime || mime.length > 256 || /[\r\n\u0000]/.test(mime)) throw unavailable();
    // Copy before awaiting the network: callers cannot mutate the bytes after hashing.
    const content = Buffer.from(bytes);
    const headers = {
      "x-oss-forbid-overwrite": "true",
      "Content-MD5": createHash("md5").update(content).digest("base64"),
      "x-oss-meta-sha256": createHash("sha256").update(content).digest("hex"),
    };
    try {
      await assertCompatible(this.client, this.bucket);
      await this.client.put(objectKey, content, { mime, headers });
    } catch (error) {
      if (failureCode(error) === "FileAlreadyExists") throw new ObjectExistsError(key);
      throw unavailable();
    }
  }
  async get(key: string): Promise<Uint8Array | null> {
    const objectKey = this.key(key);
    try {
      const result = await this.client.get(objectKey);
      const expected = result.headers["x-oss-meta-sha256"];
      if (!expected || !/^[a-f0-9]{64}$/.test(expected)
        || createHash("sha256").update(result.content).digest("hex") !== expected) throw unavailable();
      return result.content;
    } catch (error) {
      if (missing(error)) {
        // OSS HEAD does not return an XML error body; ali-oss labels all HEAD 404s
        // NoSuchKey, including missing buckets. Confirm the bucket before returning null.
        await this.assertReady();
        return null;
      }
      throw unavailable();
    }
  }
  async head(key: string): Promise<{ sizeBytes: number; mime: string } | null> {
    const objectKey = this.key(key);
    try {
      const { headers } = await this.client.head(objectKey);
      const length = headers["content-length"];
      const sizeBytes = Number(length);
      const mime = headers["content-type"];
      if (length === undefined || !/^\d+$/.test(length) || !Number.isSafeInteger(sizeBytes) || !mime) throw unavailable();
      return { sizeBytes, mime };
    } catch (error) {
      if (missing(error)) { await this.assertReady(); return null; }
      throw unavailable();
    }
  }
}

/** Separate compliance capability. Ordinary ObjectStore users cannot delete objects. */
export class OssPhysicalPurge implements PhysicalPurgePort {
  private readonly key: (key: string) => string;
  constructor(private readonly client: OssClientPort, private readonly bucket: string, prefix: string) {
    this.key = namespace(prefix);
  }
  async purgeAll(keys: readonly string[]): Promise<readonly { objectKey: string; deleted: boolean }[]> {
    const results: { objectKey: string; deleted: boolean }[] = [];
    for (const key of keys) {
      let deleted = false;
      try {
        const objectKey = this.key(key);
        await assertCompatible(this.client, this.bucket);
        try { await this.client.delete(objectKey); } catch (error) { if (!missing(error)) throw error; }
        try { await this.client.head(objectKey); }
        catch (error) {
          if (!missing(error)) throw error;
          await assertCompatible(this.client, this.bucket);
          deleted = true;
        }
      } catch { /* Partial failure is retained; never issue a successful receipt for it. */ }
      results.push({ objectKey: key, deleted });
    }
    return results;
  }
}
