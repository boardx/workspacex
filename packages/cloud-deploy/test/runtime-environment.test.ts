import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { deploymentExample } from "../src/examples";
import { runtimeEnvironment, serializeRuntimeEnvironment, stableDeploymentSecretNames } from "../src/runtime-environment";
import { ensureDeploymentSecret } from "../src/secrets";
vi.mock("../src/trusted-path", () => ({ assertTrustedPath: vi.fn() }));
const roots: string[] = [];
async function directory() {
  const p = await mkdtemp(join(tmpdir(), "runtime-env-")); roots.push(p);
  await Promise.all(stableDeploymentSecretNames.map(name => ensureDeploymentSecret(p, name)));
  return p;
}
afterEach(async () => { await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
it("never generates a missing production identity key", async () => {
  const root = await mkdtemp(join(tmpdir(), "runtime-env-missing-")); roots.push(root);
  await expect(runtimeEnvironment(deploymentExample("production"), root, { WORKSPACEX_MODEL_KEY: "model-key" }))
    .rejects.toThrow();
  expect(await import("node:fs/promises").then(fs => fs.readdir(root))).toEqual([]);
});
it("keeps Starter secrets stable and excludes owner/signing keys from unrelated services", async () => {
  const root = await directory(); const config = deploymentExample("starter");
  const first = await runtimeEnvironment(config, root, { WORKSPACEX_MODEL_KEY: "model-key" });
  expect(await runtimeEnvironment(config, root, { WORKSPACEX_MODEL_KEY: "model-key" })).toEqual(first);
  expect(first.api.WORKSPACEX_OBJECT_STORE).toBe("oss");
  expect(first.api.MIGRATION_DB_PASSWORD).toBeUndefined();
  expect(first.agent.NATIVE_SESSION_BINDING_KEY).toBeUndefined();
  expect(first.agent.MODEL_CREDENTIAL_KEY).toBeUndefined();
  expect(first.agent.KERNEL_MODEL_API_KEY).toBe(first.api.KERNEL_MODEL_API_KEY);
  expect(first.migration.MIGRATION_DB_PASSWORD).toHaveLength(64);
  expect(first.bootstrap.PROVISION_ADMIN_PASSWORD).toHaveLength(64);
  expect(first.bootstrap.MIGRATION_DB_PASSWORD).toBeUndefined();
  expect(first.bootstrap.KERNEL_MODEL_API_KEY).toBeUndefined();
  expect(JSON.stringify(first.web)).not.toContain("model-key");
});
it("uses production referenced data with TLS and no local fallback", async () => {
  const password = "a-secure-password-123";
  const value = await runtimeEnvironment(deploymentExample("production"), await directory(), {
    WORKSPACEX_MODEL_KEY: "model-key",
    WORKSPACEX_DATABASE: JSON.stringify({ host: "db.example.com", database: "workspacex", user: "app_rw", password, diagnosticsUser: "app_diag_ro", diagnosticsPassword: "diagnostics-secure-password-123" }),
    WORKSPACEX_MIGRATION: JSON.stringify({ host: "db.example.com", database: "workspacex", user: "owner", password: "migration-secure-password-123" }),
    WORKSPACEX_REDIS: JSON.stringify({ host: "redis.example.com", password, caFile: "/etc/workspacex/redis-ca.pem" }),
  });
  expect(value.api.PGHOST).toBe("db.example.com"); expect(value.api.PGSSLMODE).toBe("verify-full");
  expect(value.api.REDIS_TLS).toBe("true"); expect(value.api.MIGRATION_DB_PASSWORD).toBeUndefined();
  expect(value.api.REDIS_CA_FILE).toBe("/etc/workspacex/redis-ca.pem");
});
it("projects realtime ASR to the API only as a complete atomic profile", async () => {
  const configured = deploymentExample("production");
  configured.provision.asrProfile = {
    provider: "dashscope",
    baseUrl: "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
    modelId: "qwen3-asr-flash-realtime",
    apiKeySecretRef: "env:WORKSPACEX_ASR_KEY",
    recordingTurnSilenceMs: 650,
  };
  const source = {
    WORKSPACEX_MODEL_KEY: "model-key",
    WORKSPACEX_ASR_KEY: "asr-key",
    WORKSPACEX_DATABASE: JSON.stringify({ host: "db.example.com", database: "workspacex", user: "app_rw", password: "application-password-123", diagnosticsUser: "app_diag_ro", diagnosticsPassword: "diagnostics-password-123" }),
    WORKSPACEX_MIGRATION: JSON.stringify({ host: "db.example.com", database: "workspacex", user: "owner", password: "migration-password-123" }),
    WORKSPACEX_REDIS: JSON.stringify({ host: "redis.example.com", password: "redis-password-123", caFile: "/etc/workspacex/redis-ca.pem" }),
  };
  const maps = await runtimeEnvironment(configured, await directory(), source);
  expect(maps.api).toMatchObject({
    KERNEL_ASR_PROVIDER: "dashscope",
    KERNEL_ASR_BASE_URL: "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
    KERNEL_ASR_API_KEY: "asr-key",
    KERNEL_ASR_MODEL: "qwen3-asr-flash-realtime",
    KERNEL_ASR_RECORDING_TURN_SILENCE_MS: "650",
  });
  for (const target of [maps.agent, maps.web, maps.migration, maps.bootstrap]) {
    expect(Object.keys(target).some((key) => key.startsWith("KERNEL_ASR_"))).toBe(false);
  }

  delete configured.provision.asrProfile.recordingTurnSilenceMs;
  const defaultProfile = await runtimeEnvironment(configured, await directory(), source);
  expect(defaultProfile.api.KERNEL_ASR_RECORDING_TURN_SILENCE_MS).toBeUndefined();
  const unconfigured = await runtimeEnvironment(deploymentExample("production"), await directory(), source);
  expect(Object.keys(unconfigured.api).some((key) => key.startsWith("KERNEL_ASR_"))).toBe(false);
});
it("projects platform superusers only to the API and otherwise fails closed", async () => {
  const configured = deploymentExample("starter");
  configured.provision.platformSuperuserEmails = ["ops@example.com", "owner@example.com"];
  const maps = await runtimeEnvironment(configured, await directory(), { WORKSPACEX_MODEL_KEY: "model-key" });
  expect(maps.api.PLATFORM_SUPERUSER_EMAILS).toBe("ops@example.com,owner@example.com");
  for (const target of [maps.agent, maps.web, maps.migration, maps.bootstrap]) {
    expect(target.PLATFORM_SUPERUSER_EMAILS).toBeUndefined();
  }
  const unconfigured = await runtimeEnvironment(deploymentExample("starter"), await directory(), { WORKSPACEX_MODEL_KEY: "model-key" });
  expect(unconfigured.api.PLATFORM_SUPERUSER_EMAILS).toBeUndefined();
});
it("projects the feedback GitHub issue profile only to the API and keeps the token out when omitted", async () => {
  const configured = deploymentExample("starter");
  configured.provision.githubIssueProfile = {
    tokenSecretRef: "env:WORKSPACEX_GITHUB_ISSUE_TOKEN",
    repoOwner: "boardx",
    repoName: "workspacex",
    attachmentsBranch: "feedback-attachments",
  };
  const maps = await runtimeEnvironment(configured, await directory(), {
    WORKSPACEX_MODEL_KEY: "model-key",
    WORKSPACEX_GITHUB_ISSUE_TOKEN: "github-token",
  });
  expect(maps.api).toMatchObject({
    GITHUB_ISSUE_TOKEN: "github-token",
    GITHUB_ISSUE_REPO_OWNER: "boardx",
    GITHUB_ISSUE_REPO_NAME: "workspacex",
    GITHUB_ISSUE_ATTACHMENTS_BRANCH: "feedback-attachments",
  });
  for (const target of [maps.agent, maps.web, maps.migration, maps.bootstrap]) {
    expect(Object.keys(target).some((key) => key.startsWith("GITHUB_ISSUE_"))).toBe(false);
  }
  const unconfigured = await runtimeEnvironment(deploymentExample("starter"), await directory(), {
    WORKSPACEX_MODEL_KEY: "model-key",
    WORKSPACEX_GITHUB_ISSUE_TOKEN: "unused-token",
  });
  expect(Object.keys(unconfigured.api).some((key) => key.startsWith("GITHUB_ISSUE_"))).toBe(false);
});
it("projects the mail profile only to the API, attests preview disabled, and always gives the API its public URL", async () => {
  const configured = deploymentExample("starter");
  configured.provision.mailProfile = {
    cloudflareAccountId: "0123456789abcdef0123456789abcdef",
    apiTokenSecretRef: "env:WORKSPACEX_MAIL_TOKEN",
    mailFrom: "no-reply@mail.example.com",
    sendingDomain: "mail.example.com",
  };
  const maps = await runtimeEnvironment(configured, await directory(), { WORKSPACEX_MODEL_KEY: "model-key", WORKSPACEX_MAIL_TOKEN: "mail-token" });
  expect(maps.api).toMatchObject({
    CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
    CLOUDFLARE_EMAIL_API_TOKEN: "mail-token",
    MAIL_FROM: "no-reply@mail.example.com",
    CLOUDFLARE_EMAIL_SENDING_DOMAIN: "mail.example.com",
    CLOUDFLARE_EMAIL_PREVIEW_DISABLED: "true",
    APP_PUBLIC_URL: "https://workspace.example.com",
  });
  for (const target of [maps.agent, maps.web, maps.migration, maps.bootstrap]) {
    expect(JSON.stringify(target)).not.toContain("mail-token");
    expect(Object.keys(target).some((key) => key.startsWith("CLOUDFLARE_") || key === "MAIL_FROM")).toBe(false);
  }
  const unconfigured = await runtimeEnvironment(deploymentExample("starter"), await directory(), { WORKSPACEX_MODEL_KEY: "model-key", WORKSPACEX_MAIL_TOKEN: "unused" });
  expect(Object.keys(unconfigured.api).some((key) => key.startsWith("CLOUDFLARE_") || key === "MAIL_FROM")).toBe(false);
  expect(unconfigured.api.APP_PUBLIC_URL).toBe("https://workspace.example.com");
  await expect(runtimeEnvironment(configured, await directory(), { WORKSPACEX_MODEL_KEY: "model-key" })).rejects.toThrow(/^SECRET_UNAVAILABLE$/);
});
it("propagates the configured Serverless TLS exception to every API database process", async () => {
  const config=deploymentExample("production"); config.environment.rdsTlsException={kind:"aliyun-postgresql-serverless-no-tls",allowedCidrs:["10.0.1.7/32"]};
  const value = await runtimeEnvironment(config, await directory(), {
    WORKSPACEX_MODEL_KEY: "model-key",
    WORKSPACEX_DATABASE: JSON.stringify({ host: "db.example.com", database: "workspacex", user: "app_rw", password: "application-password-123", diagnosticsUser: "app_diag_ro", diagnosticsPassword: "diagnostics-password-123" }),
    WORKSPACEX_MIGRATION: JSON.stringify({ host: "db.example.com", database: "workspacex", user: "owner", password: "migration-password-123" }),
    WORKSPACEX_REDIS: JSON.stringify({ host: "redis.example.com", password: "redis-password-123", caFile: "/etc/workspacex/redis-ca.pem" }),
  });
  for(const target of [value.api,value.migration,value.bootstrap])expect(target).toMatchObject({PGSSLMODE:"disable",WORKSPACEX_RDS_TLS_EXCEPTION:"aliyun-postgresql-serverless-no-tls"});
});
it("redacts invalid production secret JSON", async () => {
  await expect(runtimeEnvironment(deploymentExample("production"), await directory(), {
    WORKSPACEX_MODEL_KEY: "key", WORKSPACEX_DATABASE: "SECRET-invalid-json",
  })).rejects.toThrow(/^PRODUCTION_DATA_CONFIGURATION_INVALID$/);
});
it("preserves literal dollar characters and refuses newline injection", () => {
  expect(serializeRuntimeEnvironment({ PASSWORD: 'a$b#c\\d' })).toBe('PASSWORD=a$b#c\\d\n');
  expect(() => serializeRuntimeEnvironment({ PASSWORD: "x\nINJECT=true" })).toThrow("INVALID_RUNTIME_ENVIRONMENT");
  expect(() => serializeRuntimeEnvironment({ "BAD=KEY": "value" })).toThrow("INVALID_RUNTIME_ENVIRONMENT");
});

it("isolates Starter graph-server persistence from application credentials and database", async () => {
  const root = await directory();
  const maps = await runtimeEnvironment(deploymentExample("starter"), root, { WORKSPACEX_MODEL_KEY: "model-key" });
  const uri = new URL(maps.agent.DATABASE_URI!);
  expect(uri.username).toBe("agent_server"); expect(uri.pathname).toBe("/workspacex_agent");
  expect(uri.password).toBe(maps.migration.AGENT_DB_PASSWORD);
  expect(uri.password).not.toBe(maps.api.APP_DB_PASSWORD);
  expect(maps.api.AGENT_DB_PASSWORD).toBeUndefined(); expect(maps.bootstrap.AGENT_DB_PASSWORD).toBeUndefined();
  expect(new URL(maps.agent.REDIS_URI!).pathname).toBe("/1");
  expect((await runtimeEnvironment(deploymentExample("starter"), root, { WORKSPACEX_MODEL_KEY: "model-key" })).agent.DATABASE_URI).toBe(maps.agent.DATABASE_URI);
});

it("keeps Memory runtime and schema-owner credentials separate from API and Agent Server", async () => {
  const maps = await runtimeEnvironment(deploymentExample("starter"), await directory(), { WORKSPACEX_MODEL_KEY: "model-key" });
  const runtime = new URL(maps.agent.MEMORY_STORE_DATABASE_URL!);
  const owner = new URL(maps.memoryMigration.MEMORY_STORE_MIGRATION_DATABASE_URL!);
  const graph = new URL(maps.agent.DATABASE_URI!);
  expect(runtime.username).toBe("memory_rw"); expect(owner.username).toBe("memory_owner");
  expect(runtime.pathname).toBe("/workspacex_memory"); expect(owner.pathname).toBe(runtime.pathname);
  expect(new Set([runtime.password, owner.password, graph.password]).size).toBe(3);
  expect(maps.agent.MEMORY_STORE_MIGRATION_DATABASE_URL).toBeUndefined();
  expect(Object.keys(maps.api).some(key => key.startsWith("MEMORY_DB_"))).toBe(false);
  expect(maps.memoryMigration.MEMORY_STORE_DATABASE_URL).toBe(maps.agent.MEMORY_STORE_DATABASE_URL);
});
