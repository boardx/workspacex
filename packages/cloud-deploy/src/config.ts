import { z } from "zod";

const text = z.string().min(1).max(512).regex(/^(?!.*REPLACE_WITH_)[^\s\u0000-\u001f]+$/);
const identifier = text.regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
const region = text.regex(/^[a-z]{2}-[a-z]+-\d+$|^[a-z]{2}-[a-z]+$/);
// Only references are accepted. No values are read or expanded by this package.
const secretRef = text.regex(/^(env:[A-Z][A-Z0-9_]*|file:\/(?:[a-zA-Z0-9_-][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9._-]*)$/);
const absoluteDirectory = text.regex(/^\/(?:[a-zA-Z0-9_-][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/);
// URLs cannot contain credentials, query strings or fragments. Configuration URLs are
// not fetched during validation. The cloud preflight must verify routing and reachability.
const origin = text.regex(/^https:\/\/[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?(?::[1-9][0-9]{0,4})?\/?$/).url();
const modelUrl = text.regex(/^https:\/\/[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?(?::[1-9][0-9]{0,4})?(?:\/[a-zA-Z0-9._~-]+)*\/?$/).url();
const commonEnvironment = {
  regionId: region,
  ecsInstanceId: text.regex(/^i-[a-zA-Z0-9]+$/),
  runtimeRole: identifier,
  ossBucket: text.regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
  ossEndpoint: text.regex(/^https:\/\/oss-[a-z0-9-]+(?:-internal)?\.aliyuncs\.com$/),
  ossPrefix: text.regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/?$/),
  publicUrl: origin,
  tlsSecretRef: secretRef,
};
const starter = z.object({
  ...commonEnvironment,
  profile: z.literal("starter"),
  dataVolumePath: absoluteDirectory,
  backupTargetRef: secretRef,
}).strict();
const production = z.object({
  ...commonEnvironment,
  profile: z.literal("production"),
  rdsInstanceId: text.regex(/^pgm-[a-zA-Z0-9]+$/),
  redisInstanceId: text.regex(/^r-[a-zA-Z0-9]+$/),
  databaseSecretRef: secretRef,
  migrationSecretRef: secretRef,
  redisSecretRef: secretRef,
  backupRetentionDays: z.number().int().min(1).max(3650),
}).strict();

/** Structural contract shared by runtime validation and the generated JSON Schema. */
export const deploymentInputSchema = z.object({
  schemaVersion: z.literal(1),
  environment: z.discriminatedUnion("profile", [starter, production]),
  provision: z.object({
    release: text.regex(/^v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/),
    adminEmail: z.string().max(254).email(),
    modelProfile: z.object({
      baseUrl: modelUrl,
      modelId: identifier,
      apiKeySecretRef: secretRef,
    }).strict(),
  }).strict(),
}).strict();

/** Cross-field conditions also run in the CLI; JSON Schema is only structural validation. */
export const deploymentConfigSchema = deploymentInputSchema.superRefine((config, ctx) => {
  const env = config.environment;
  const endpoints = [
    `https://oss-${env.regionId}.aliyuncs.com`,
    `https://oss-${env.regionId}-internal.aliyuncs.com`,
  ];
  if (!endpoints.includes(env.ossEndpoint)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["environment", "ossEndpoint"], message: "REGION_MISMATCH" });
  }
  if (env.profile === "production" && env.databaseSecretRef === env.migrationSecretRef) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["environment", "migrationSecretRef"], message: "SEPARATE_ROLES_REQUIRED" });
  }
});

export type DeploymentConfig = z.infer<typeof deploymentConfigSchema>;
export type DeploymentProfile = DeploymentConfig["environment"]["profile"];
export type ConfigError = { path: string; code: string };

export function validateDeploymentConfig(input: unknown):
  | { ok: true; config: DeploymentConfig; plan: ReturnType<typeof deploymentPlan> }
  | { ok: false; errors: ConfigError[] } {
  const result = deploymentConfigSchema.safeParse(input);
  if (!result.success) {
    // Zod's messages can contain unknown property names and received enum values. Only
    // emit fixed codes and schema-owned paths, never user-controlled messages or values.
    const errors = result.error.issues.map((issue) => ({
      path: issue.path.join(".") || "$",
      code: issue.code === "custom" ? issue.message : issue.code,
    }));
    return { ok: false, errors };
  }
  return { ok: true, config: result.data, plan: deploymentPlan(result.data) };
}

function deploymentPlan(config: DeploymentConfig) {
  return {
    profile: config.environment.profile,
    release: config.provision.release,
    database: config.environment.profile === "starter" ? "ecs-postgresql" : "rds-postgresql",
    redis: config.environment.profile === "starter" ? "ecs-redis" : "managed-redis",
    objectStorage: "oss" as const,
    applicationReplicas: 1,
    provisionDeadlineSeconds: 300,
    cloudVerified: false as const,
    status: "configuration-valid-cloud-preflight-required" as const,
  };
}
