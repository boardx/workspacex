import { mkdtemp, readFile, rm, lstat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { deploymentExample } from "../src/examples";
import { writeRuntimeBundle, writeRuntimeFile } from "../src/runtime-bundle";
vi.mock("node:fs/promises", async original => ({ ...await original<typeof import("node:fs/promises")>(), chown: vi.fn() }));
const roots: string[] = [];
async function directory() { const path = await mkdtemp(join(tmpdir(), "cloud-bundle-")); roots.push(path); return path; }
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { force: true, recursive: true }))); });
const context = () => ({ signal: new AbortController().signal, remainingMs: () => 30000 });
const image = { image: `registry.example/team/app@sha256:${"b".repeat(64)}` };
const manifest = { schemaVersion: 1 as const, release: "1.0.0", sourceRevision: "a".repeat(40), platform: "linux/amd64" as const,
  images: { web: image, api: image, agent: image, sandbox: image, postgres: image, redis: image } };
it("writes service-scoped private raw env files and generated Starter Agent credentials", async () => {
  const runtimeDirectory = await directory();
  const maps = await writeRuntimeBundle(deploymentExample("starter"), manifest,
    { runtimeDirectory, projectName: "example", agentEnvironmentSecretRef: "env:AGENT_LICENSE" }, context(),
    { WORKSPACEX_MODEL_KEY: "literal$${secret}", AGENT_LICENSE: JSON.stringify({ LANGGRAPH_CLOUD_LICENSE_KEY: "license-value" }) });
  const api = await readFile(join(runtimeDirectory, "api.env"), "utf8");
  const agent = await readFile(join(runtimeDirectory, "agent.env"), "utf8");
  expect(api).toContain("KERNEL_MODEL_API_KEY=literal$${secret}\n");
  expect(api).not.toContain("MIGRATION_DB_PASSWORD"); expect(api).not.toContain("AGENT_DB_PASSWORD"); expect(api).not.toContain("license-value");
  expect(agent).toContain("postgresql://agent_server:"); expect(agent).toContain("/workspacex_agent");
  expect(agent).not.toContain("MODEL_CREDENTIAL_KEY");
  expect((await lstat(join(runtimeDirectory, "agent.env"))).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await readFile(join(runtimeDirectory, "compose.json"), "utf8")).networks.default).toEqual({ external: true, name: "example-runtime" });
  expect(maps.web.API_INTERNAL_URL).toBe("http://api:3200");
});
it("does not accept externally overridden Starter graph database credentials", async () => {
  await expect(writeRuntimeBundle(deploymentExample("starter"), manifest,
    { runtimeDirectory: await directory(), projectName: "example", agentEnvironmentSecretRef: "env:AGENT_LICENSE" }, context(),
    { WORKSPACEX_MODEL_KEY: "model", AGENT_LICENSE: JSON.stringify({ LANGGRAPH_CLOUD_LICENSE_KEY: "license", DATABASE_URI: "postgresql://attacker/other" }) })).rejects.toThrow("AGENT_PERSISTENCE_CONFIGURATION_INVALID");
});
it("atomic env replacement never follows a destination symlink", async () => {
  const root = await directory(); const outside = join(root, "outside"); const target = join(root, "service.env");
  await writeFile(outside, "keep"); await symlink(outside, target);
  await writeRuntimeFile(target, "NEW=value\n", context());
  expect(await readFile(outside, "utf8")).toBe("keep"); expect((await lstat(target)).isSymbolicLink()).toBe(false);
});
it("does not replace an existing env file after cancellation", async () => {
  const target = join(await directory(), "service.env"); await writeFile(target, "previous");
  const controller = new AbortController(); controller.abort();
  await expect(writeRuntimeFile(target, "next", { signal: controller.signal, remainingMs: () => 100 })).rejects.toThrow("PROVISION_CANCELLED");
  expect(await readFile(target, "utf8")).toBe("previous");
});

it("mounts explicit libpq CAs and limits Memory owner credentials to the setup job", async () => {
  const { rootCertificates } = await import("node:tls");
  const runtimeDirectory = await directory(); const ca = join(runtimeDirectory, "source-ca.pem");
  await writeFile(ca, rootCertificates[0]!);
  const source = {
    WORKSPACEX_MODEL_KEY: "model-key",
    WORKSPACEX_DATABASE: JSON.stringify({ host: "db.example.com", database: "workspacex", user: "app_rw", password: "application-password-123", diagnosticsUser: "app_diag_ro", diagnosticsPassword: "diagnostics-password-123" }),
    WORKSPACEX_MIGRATION: JSON.stringify({ host: "db.example.com", database: "workspacex", user: "owner", password: "application-owner-123" }),
    WORKSPACEX_REDIS: JSON.stringify({ host: "redis.example.com", password: "redis-password-123" }),
    AGENT_SECRET: JSON.stringify({ DATABASE_URI: "postgresql://graph_owner:graph-password@graph.example.com/graph?sslmode=verify-full",
      REDIS_URI: "rediss://:redis-password@redis.example.com:6380/1", LANGGRAPH_CLOUD_LICENSE_KEY: "license-value", databaseCaFile: ca, memoryCaFile: ca,
      MEMORY_STORE_DATABASE_URL: "postgresql://memory_rw:memory-runtime-password@memory.example.com/memory?sslmode=verify-full",
      MEMORY_STORE_MIGRATION_DATABASE_URL: "postgresql://memory_owner:memory-owner-password@memory.example.com/memory?sslmode=verify-full" }),
  };
  const maps = await writeRuntimeBundle(deploymentExample("production"), manifest,
    { runtimeDirectory, projectName: "example", agentEnvironmentSecretRef: "env:AGENT_SECRET" }, context(), source);
  expect(new URL(maps.agent.DATABASE_URI!).searchParams.get("sslrootcert")).toBe("/run/agent-certs/ca.pem");
  expect(new URL(maps.agent.MEMORY_STORE_DATABASE_URL!).searchParams.get("sslrootcert")).toBe("/run/agent-certs/memory-ca.pem");
  expect(await readFile(join(runtimeDirectory, "agent-certs/memory-ca.pem"), "utf8")).toBe(rootCertificates[0]);
  expect(JSON.stringify(maps.agent)).not.toContain("memory-owner-password");
  expect(JSON.stringify(maps.api)).not.toContain("memory-owner-password");
  expect(maps.memoryMigration.MEMORY_STORE_MIGRATION_DATABASE_URL).toContain("memory-owner-password");
  const compose = JSON.parse(await readFile(join(runtimeDirectory, "compose.json"), "utf8"));
  expect(compose.services.agent.volumes).toContainEqual(expect.objectContaining({ target: "/run/agent-certs", read_only: true }));
});
