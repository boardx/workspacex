import { createRequire } from "node:module";
import OSS from "ali-oss";
import { ObjectStoreUnavailableError } from "../../application/artifact/ports";
import type { OssClientPort } from "./oss-object-store";
import type { OssRuntimeConfig } from "./object-store-config";

// This dependency exports a CommonJS object with a `.default` constructor. require avoids
// Node ESM / tsx / Vitest disagreeing about whether a second default unwrap is necessary.
const { default: Credential, Config } = createRequire(import.meta.url)("@alicloud/credentials") as typeof import("@alicloud/credentials");
type CredentialValue = { accessKeyId: string; accessKeySecret: string; stsToken: string };
export type CredentialSource = () => Promise<CredentialValue>;

export function ossCredentialSource(config: OssRuntimeConfig, env: NodeJS.ProcessEnv): CredentialSource {
  if (config.authMode === "environment") return async () => {
    if (!env.OSS_ACCESS_KEY_ID || !env.OSS_ACCESS_KEY_SECRET) throw new ObjectStoreUnavailableError("OSS credentials unavailable");
    return { accessKeyId: env.OSS_ACCESS_KEY_ID, accessKeySecret: env.OSS_ACCESS_KEY_SECRET, stsToken: env.OSS_SECURITY_TOKEN ?? "" };
  };
  const client = new Credential(new Config({ type: "ecs_ram_role", roleName: config.roleName,
    timeout: 5000, connectTimeout: 3000, disableIMDSv1: true }));
  return async () => {
    try {
      const value = await client.getCredential();
      if (!value.accessKeyId || !value.accessKeySecret || !value.securityToken) throw new Error("missing credentials");
      return { accessKeyId: value.accessKeyId, accessKeySecret: value.accessKeySecret, stsToken: value.securityToken };
    } catch { throw new ObjectStoreUnavailableError("OSS credentials unavailable"); }
  };
}

export async function createOssSdkClient(config: OssRuntimeConfig, env: NodeJS.ProcessEnv): Promise<OssClientPort> {
  const source = ossCredentialSource(config, env);
  const credentials = await source();
  const sdk = new OSS({
    ...credentials, bucket: config.bucket, region: `oss-${config.region}`, endpoint: config.endpoint,
    secure: true, authorizationV4: true, timeout: 10_000,
    refreshSTSToken: source, refreshSTSTokenInterval: 0,
  });
  return wrapOssSdk(sdk);
}

/** Narrow typed bridge, also used by the actual SDK-over-HTTP contract tests. */
export function wrapOssSdk(sdk: OSS): OssClientPort {
  // ali-oss implements getBucketVersioning; @types/ali-oss does not declare it yet.
  const versionedSdk = sdk as OSS & { getBucketVersioning(bucket: string): Promise<{ versionStatus?: string }> };
  return {
    getBucketVersioning: (bucket) => versionedSdk.getBucketVersioning(bucket),
    getBucketACL: async (bucket) => ({ acl: (await sdk.getBucketACL(bucket)).acl }),
    put: async (key, bytes, options) => { await sdk.put(key, bytes, options); },
    get: async (key) => {
      const result = await sdk.get(key);
      if (!Buffer.isBuffer(result.content)) throw new ObjectStoreUnavailableError("OSS unavailable");
      return { content: result.content, headers: normalizeHeaders(result.res.headers) };
    },
    head: async (key) => ({ headers: normalizeHeaders((await sdk.head(key)).res.headers) }),
    delete: async (key) => { await sdk.delete(key); },
  };
}

function normalizeHeaders(headers: object): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string" || typeof value === "number") values[key.toLowerCase()] = String(value);
  }
  return values;
}
