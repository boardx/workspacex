import type { DeploymentConfig } from "./config";
import { deploymentStorageEnvironment } from "./storage-config";
import { productionDataEnvironment } from "./data-secrets";
import { ensureDeploymentSecret, resolveSecret, assertSecretOperationActive, type SecretOperationContext } from "./secrets";

export type RuntimeEnvironmentMaps = Record<"api" | "agent" | "migration" | "bootstrap" | "web" | "dependencies" | "memoryMigration", Record<string, string>>;

/** Return private service-specific maps. Never send these maps to the plan/CLI stdout.
 * Agent Server persistence/license and TLS files are additional required inputs at startup.
 */
export async function runtimeEnvironment(config: DeploymentConfig, secretDirectory: string, source: NodeJS.ProcessEnv = process.env, context: SecretOperationContext = {}): Promise<RuntimeEnvironmentMaps> {
  assertSecretOperationActive(context);
  const names = ["model-cipher", "native-binding", "service-key", "admin-password", "app-password", "owner-password", "diag-password", "redis-password", "agent-password", "memory-password", "memory-owner-password"] as const;
  const outcomes = await Promise.allSettled(names.map(name => ensureDeploymentSecret(secretDirectory, name, context)));
  // Wait for all in-flight file cleanup before returning failure or cancellation.
  const values: string[] = [];
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") throw outcome.reason;
    values.push(outcome.value);
  }
  assertSecretOperationActive(context);
  const secret = Object.fromEntries(names.map((name, i) => [name, values[i]!])) as Record<typeof names[number], string>;
  const modelKey = await resolveSecret(config.provision.modelProfile.apiKeySecretRef, source, context);
  const model = {
    KERNEL_MODEL_PROVIDER: "openai-compatible",
    KERNEL_MODEL_BASE_URL: config.provision.modelProfile.baseUrl,
    KERNEL_MODEL_API_KEY: modelKey,
    KERNEL_DEEP_AGENT_MODEL_ID: config.provision.modelProfile.modelId,
    KERNEL_DEFAULT_AGENT_MODEL_ID: config.provision.modelProfile.modelId,
  };
  let data: Record<string, string>;
  const environment = config.environment;
  if (environment.profile === "production") {
    try {
      const [db, migration, redis] = await Promise.all([environment.databaseSecretRef, environment.migrationSecretRef, environment.redisSecretRef].map(ref => resolveSecret(ref, source, context)));
      data = productionDataEnvironment(JSON.parse(db!), JSON.parse(migration!), JSON.parse(redis!));
    } catch { assertSecretOperationActive(context); throw new Error("PRODUCTION_DATA_CONFIGURATION_INVALID"); }
  } else {
    data = { PGHOST: "postgres", PGPORT: "5432", PGDATABASE: "workspacex", PGSSLMODE: "disable",
      APP_DB_USER: "app_rw", APP_DB_PASSWORD: secret["app-password"],
      MIGRATION_DB_USER: "postgres", MIGRATION_DB_PASSWORD: secret["owner-password"],
      DIAG_DB_USER: "app_diag_ro", DIAG_DB_PASSWORD: secret["diag-password"],
      AGENT_DB_USER: "agent_server", AGENT_DB_PASSWORD: secret["agent-password"], AGENT_DB_DATABASE: "workspacex_agent",
      MEMORY_DB_USER: "memory_rw", MEMORY_DB_PASSWORD: secret["memory-password"], MEMORY_DB_OWNER: "memory_owner",
      MEMORY_DB_OWNER_PASSWORD: secret["memory-owner-password"], MEMORY_DB_DATABASE: "workspacex_memory",
      REDIS_HOST: "redis", REDIS_PORT: "6379", REDIS_PASSWORD: secret["redis-password"], REDIS_TLS: "false" };
  }
  const apiData = Object.fromEntries(Object.entries(data).filter(([key]) => !key.startsWith("MIGRATION_DB_") && !key.startsWith("AGENT_DB_") && !key.startsWith("MEMORY_DB_")));
  const sharedNative = { NATIVE_SESSION_SOCKET: "/run/sessions/skill-sandbox.sock", DEEP_AGENT_SERVICE_INTERNAL_KEY: secret["service-key"] };
  const api: Record<string, string> = { ...deploymentStorageEnvironment(config), ...apiData, ...model, ...sharedNative,
    NODE_ENV: "production", PORT: "3200", MODEL_CREDENTIAL_KEY: secret["model-cipher"],
    NATIVE_SESSION_BINDING_KEY: secret["native-binding"], KERNEL_NATIVE_RUNTIME: "1",
    KERNEL_SKILL_SANDBOX_SOCKET: "/run/sandbox/skill-sandbox.sock",
    KERNEL_DEEP_AGENT_BASE_URL: "http://agent:8000", KERNEL_SUBTASK_CALLBACK_BASE_URL: "http://api:3200" };
  const agent: Record<string, string> = { ...model, ...sharedNative,
    NATIVE_SESSION_SERVICE_BASE_URL: "http://api:3200", NATIVE_SESSION_SERVICE_KEY: secret["service-key"] };
  const memoryMigration: Record<string, string> = {};
  if (environment.profile === "starter") {
    agent.MEMORY_STORE_DATABASE_URL = `postgresql://memory_rw:${secret["memory-password"]}@postgres:5432/workspacex_memory`;
    agent.MEMORY_STORE_SCHEMA = "workspacex_memory";
    Object.assign(memoryMigration, { MEMORY_STORE_DATABASE_URL: agent.MEMORY_STORE_DATABASE_URL, MEMORY_STORE_MIGRATION_DATABASE_URL: `postgresql://memory_owner:${secret["memory-owner-password"]}@postgres:5432/workspacex_memory`, MEMORY_STORE_SCHEMA: agent.MEMORY_STORE_SCHEMA });
    agent.DATABASE_URI = `postgresql://agent_server:${secret["agent-password"]}@postgres:5432/workspacex_agent`;
    agent.REDIS_URI = `redis://:${secret["redis-password"]}@redis:6379/1`;
  }
  const bootstrapData = Object.fromEntries(Object.entries(data).filter(([key]) => key.startsWith("PG") || key.startsWith("APP_DB_")));
  const bootstrap: Record<string, string> = { ...bootstrapData, WORKSPACEX_DEPLOY_PROFILE: environment.profile, KERNEL_DEFAULT_AGENT_MODEL_ID: config.provision.modelProfile.modelId, PROVISION_ADMIN_EMAIL: config.provision.adminEmail,
    PROVISION_ADMIN_PASSWORD: secret["admin-password"], PROVISION_ADMIN_NAME: "Administrator", PROVISION_ORG_NAME: "Workspace" };
  assertSecretOperationActive(context);
  return { api, agent, memoryMigration, migration: { ...data, WORKSPACEX_DEPLOY_PROFILE: environment.profile }, bootstrap,
    web: { NODE_ENV: "production", PORT: "3000", API_INTERNAL_URL: "http://api:3200" },
    dependencies: { POSTGRES_USER: data.MIGRATION_DB_USER!, POSTGRES_PASSWORD: data.MIGRATION_DB_PASSWORD!, POSTGRES_DB: data.PGDATABASE!, REDIS_PASSWORD: data.REDIS_PASSWORD! } };
}

/** Docker/Compose raw env-file format, never shell source. Newline injection is refused. */
export function serializeRuntimeEnvironment(values: Record<string, string>): string {
  return Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || /[\r\n\0]/.test(value)) throw new Error("INVALID_RUNTIME_ENVIRONMENT");
    return `${key}=${value}`;
  }).join("\n") + "\n";
}
