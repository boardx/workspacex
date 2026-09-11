import type { DeploymentConfig, DeploymentProfile } from "./config";

/** Syntactically valid illustrative values. Never proof that these resources exist. */
export function deploymentExample<P extends DeploymentProfile>(profile: P):
  DeploymentConfig & { environment: Extract<DeploymentConfig["environment"], { profile: P }> } {
  const environment = {
    regionId: "cn-hangzhou", ecsInstanceId: "i-example", runtimeRole: "workspacex-runtime",
    ossBucket: "workspacex-example", ossEndpoint: "https://oss-cn-hangzhou-internal.aliyuncs.com",
    ossPrefix: "deployments/example", publicUrl: "https://workspace.example.com",
    tlsSecretRef: "env:WORKSPACEX_TLS_CONFIG",
  };
  const input = {
    schemaVersion: 1 as const,
    environment: profile === "starter" ? {
      ...environment, profile: "starter" as const,
      dataVolumePath: "/var/lib/workspacex", backupTargetRef: "env:WORKSPACEX_BACKUP_TARGET",
    } : {
      ...environment, profile: "production" as const,
      rdsInstanceId: "pgm-example", redisInstanceId: "r-example",
      databaseSecretRef: "env:WORKSPACEX_DATABASE", migrationSecretRef: "env:WORKSPACEX_MIGRATION",
      redisSecretRef: "env:WORKSPACEX_REDIS", backupRetentionDays: 7, logRetentionDays: 30,
      alertContactRef: "env:WORKSPACEX_ALERT_CONTACT",
    },
    provision: {
      release: "1.0.0", adminEmail: "owner@example.com",
      modelProfile: { baseUrl: "https://model.example.com/v1", modelId: "example-model", apiKeySecretRef: "env:WORKSPACEX_MODEL_KEY" },
    },
  };
  return input as DeploymentConfig & { environment: Extract<DeploymentConfig["environment"], { profile: P }> };
}
