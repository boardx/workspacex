import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { deploymentExample } from "../src/examples";
import { runtimeEnvironment, serializeRuntimeEnvironment } from "../src/runtime-environment";
vi.mock("../src/trusted-path", () => ({ assertTrustedPath: vi.fn() }));
const roots: string[] = [];
async function directory() { const p = await mkdtemp(join(tmpdir(), "runtime-env-")); roots.push(p); return p; }
afterEach(async () => { await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
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
    WORKSPACEX_REDIS: JSON.stringify({ host: "redis.example.com", password }),
  });
  expect(value.api.PGHOST).toBe("db.example.com"); expect(value.api.PGSSLMODE).toBe("verify-full");
  expect(value.api.REDIS_TLS).toBe("true"); expect(value.api.MIGRATION_DB_PASSWORD).toBeUndefined();
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
