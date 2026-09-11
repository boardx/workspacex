import type { DeploymentConfig } from "./config";
import { z } from "zod";

const ossSchema = z.object({
  region: z.string().regex(/^[a-z]{2}-[a-z]+(?:-\d+)?$/),
  bucket: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
  endpoint: z.string().url(),
  prefix: z.string().regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/?$/),
  authMode: z.enum(["ecs-role", "environment"]),
  roleName: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/).optional(),
}).superRefine((v, ctx) => {
  if (![ `https://oss-${v.region}.aliyuncs.com`, `https://oss-${v.region}-internal.aliyuncs.com` ].includes(v.endpoint)) {
    ctx.addIssue({ code: "custom", path: ["endpoint"], message: "region mismatch" });
  }
  if (v.authMode === "ecs-role" && !v.roleName) ctx.addIssue({ code: "custom", path: ["roleName"], message: "required" });
});
export type OssRuntimeConfig = z.infer<typeof ossSchema>;
export type StorageConfig = { backend: "fs"; root?: string } | { backend: "oss"; oss: OssRuntimeConfig };

/** Reads configuration at bootstrap, never at module load, matching existing FS semantics. */
export function objectStoreConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  const profile = env.WORKSPACEX_DEPLOY_PROFILE;
  if (profile !== undefined && profile !== "starter" && profile !== "production") throw new Error("Invalid WORKSPACEX_DEPLOY_PROFILE");
  const backend = env.WORKSPACEX_OBJECT_STORE ?? (profile ? "oss" : "fs");
  if (backend !== "oss" && backend !== "fs") throw new Error("Invalid WORKSPACEX_OBJECT_STORE");
  if (profile && backend !== "oss") throw new Error("Cloud deployments require OSS");
  if (backend === "fs") {
    if ([env.OSS_BUCKET, env.OSS_REGION, env.OSS_ENDPOINT, env.OSS_PREFIX].some(v => v !== undefined)) {
      throw new Error("OSS configuration requires WORKSPACEX_OBJECT_STORE=oss");
    }
    return { backend, root: env.WORKSPACEX_OBJECT_ROOT || undefined };
  }
  const result = ossSchema.safeParse({
    region: env.OSS_REGION, bucket: env.OSS_BUCKET, endpoint: env.OSS_ENDPOINT, prefix: env.OSS_PREFIX,
    authMode: env.OSS_AUTH_MODE ?? "ecs-role", roleName: env.OSS_ROLE_NAME,
  });
  if (!result.success) throw new Error(`Invalid OSS configuration: ${[...new Set(result.error.issues.map(i => i.path.join(".")))].join(", ")}`);
  return { backend, oss: result.data };
}

/** Non-secret OSS bootstrap variables; other service settings are rendered separately. */
export function deploymentStorageEnvironment(config: DeploymentConfig): Record<string, string> {
  const value = config.environment;
  const env = {
    WORKSPACEX_DEPLOY_PROFILE: value.profile,
    WORKSPACEX_OBJECT_STORE: "oss",
    OSS_REGION: value.regionId,
    OSS_BUCKET: value.ossBucket,
    OSS_ENDPOINT: value.ossEndpoint,
    OSS_PREFIX: value.ossPrefix,
    OSS_AUTH_MODE: "ecs-role",
    OSS_ROLE_NAME: value.runtimeRole,
  };
  objectStoreConfig(env);
  return env;
}
