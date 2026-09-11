import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { deploymentExample } from "../src/examples";
import { runtimeEnvironment, serializeRuntimeEnvironment } from "../src/runtime-environment";
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
    WORKSPACEX_DATABASE: JSON.stringify({ host: "db.example.com", database: "workspacex", user: "app_rw", password, diagnosticsUser: "app_diag_ro", diagnosticsPassword: password }),
    WORKSPACEX_MIGRATION: JSON.stringify({ host: "db.example.com", database: "workspacex", user: "owner", password }),
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
