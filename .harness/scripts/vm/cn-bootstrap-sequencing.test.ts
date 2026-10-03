import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repository = resolve(import.meta.dirname, "../../..");
const sha = "a".repeat(40), baseline = "b".repeat(40), digest = `sha256:${"1".repeat(64)}`;
const folders: string[] = [];
function dir() { const path = mkdtempSync(resolve(tmpdir(), "bootstrap-sequence-")); folders.push(path); return path; }
afterEach(() => { for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true }); });
function source(phase = "prebuild", invalid = false) {
  const path = dir(), envFile = resolve(path, "bootstrap.env");
  writeFileSync(envFile, ["WORKSPACEX_DEPLOY_PROFILE=production", "PGHOST=127.0.0.1", "PGPORT=1", "PGDATABASE=no_database", "PGSSLMODE=verify-full", "PGSSLROOTCERT=", "APP_DB_USER=app_rw", "APP_DB_PASSWORD=test-only-fixture-password", `PROVISION_ADMIN_EMAIL=${invalid ? "invalid" : "admin@example.test"}`, "PROVISION_ADMIN_PASSWORD=test-only-fixture-password", "PROVISION_ADMIN_NAME=Administrator", "PROVISION_ORG_NAME=Production"].join("\n") + "\n");
  return spawnSync(process.execPath, [resolve(repository, ".harness/scripts/vm/cn-bootstrap-source-probe.mjs"), envFile, repository, phase, sha, digest], { encoding: "utf8", timeout: 15000 });
}
function bootstrap(phase: string) {
  const dynamic = phase === "preactivate";
  return { schemaVersion: 1, sourceSha: sha, phase, ...(dynamic ? { imageDigest: digest } : {}), ready: true, readOnlyTransaction: dynamic, productionWriteStatements: 0, stateClass: dynamic ? "empty" : "unknown", checks: { [dynamic ? "imageEntrypoint" : "sourceEntrypoint"]: true, inputContract: true, schemaContract: dynamic, permissionContract: dynamic, agentSeedContract: dynamic }, blockers: [] };
}
function assemble(phase: string, value: ReturnType<typeof bootstrap>) {
  const path = dir();
  const file = (name: string, content: unknown, prefix = "") => { const p = resolve(path, name); writeFileSync(p, prefix + JSON.stringify(content) + "\n"); return p; };
  const output = resolve(path, "evidence.json");
  const manifest = file("manifest.json", { images: Object.fromEntries(["api", "web", "agent", "sandbox"].map(service => [service, { image: `registry.test/${service}@${digest}` }])) });
  const args = [output, phase, "attempt-one", sha, baseline, "2026.10.3-cn.1", "12", "3600", "/browser", manifest,
    file("prior.json", {}), file("bootstrap.out", value, "CN_BOOTSTRAP_COMPAT_JSON="), file("runtime.out", { ready: true }, "CN_RUNTIME_ENVIRONMENT_PREFLIGHT_JSON="), file("stable.out", { passed: true }, "CN_STABLE_SECRET_PREFLIGHT "), file("managed.out", { ready: true }, "CN_MANAGED_DATA_PREFLIGHT_JSON="), file("protocol.out", { passed: true })];
  const run = spawnSync(process.execPath, [resolve(repository, ".harness/scripts/vm/cn-release-preflight-evidence.mjs"), ...args], { encoding: "utf8" });
  return { run, value: run.status === 0 ? JSON.parse(readFileSync(output, "utf8")) : undefined };
}
describe("bootstrap phase sequencing", () => {
  it("runs the actual prebuild source closure with no reachable DB and no database claims", () => {
    const run = source(); expect(run.error).toBeUndefined(); expect(run.status).toBe(0);
    const record = JSON.parse(run.stdout.trim().split("CN_BOOTSTRAP_COMPAT_JSON=")[1]!);
    expect(record).toMatchObject({ ready: true, readOnlyTransaction: false, stateClass: "unknown", checks: { schemaContract: false, permissionContract: false, agentSeedContract: false } });
  }, 20000);
  it("rejects invalid actual source input", () => { const run = source("prebuild", true); expect(run.status).toBe(1); expect(run.stdout).toContain("BOOTSTRAP_INPUT_INVALID"); }, 20000);
  it("rejects a missing source dependency closure", () => {
    const path = dir(), envFile = resolve(path, "empty.env"); writeFileSync(envFile, "WORKSPACEX_DEPLOY_PROFILE=production\n");
    const run = spawnSync(process.execPath, [resolve(repository, ".harness/scripts/vm/cn-bootstrap-source-probe.mjs"), envFile, path, "prebuild", sha], { encoding: "utf8" });
    expect(run.status).toBe(1); expect(run.stdout).not.toContain('"ready":true');
  });
  it("does not silently make the preactivate source probe static", () => { const run = source("preactivate"); expect(run.status).toBe(1); expect(run.stdout).toContain('"ready":false'); }, 20000);
  it("assembles source-static admission without claiming schema or a transaction", () => {
    const result = assemble("prebuild", bootstrap("prebuild")); expect(result.run.status).toBe(0);
    expect(result.value.checks["bootstrap.compatibility"].metadata).toMatchObject({ evidenceMode: "source-static", readOnlyTransaction: false, schemaContract: false });
  });
  it("rejects static source evidence for activation even if phase/image identity is relabelled", () => {
    const value = bootstrap("prebuild"); value.phase = "preactivate"; Object.assign(value, { imageDigest: digest });
    expect(assemble("preactivate", value).run.status).toBe(1);
  });
  it("accepts the full dynamic image proof after migration", () => { const result = assemble("preactivate", bootstrap("preactivate")); expect(result.run.status).toBe(0); expect(result.value.checks["bootstrap.compatibility"].metadata.evidenceMode).toBe("database-dynamic"); });
  it.each(["schemaContract", "permissionContract", "agentSeedContract"])("rejects missing dynamic %s", key => { const value = bootstrap("preactivate"); value.checks[key] = false; expect(assemble("preactivate", value).run.status).toBe(1); });
  it("rejects source and image identity changes", () => { const sourceValue = bootstrap("prebuild"); sourceValue.sourceSha = baseline; expect(assemble("prebuild", sourceValue).run.status).toBe(1); const imageValue = bootstrap("preactivate"); imageValue.imageDigest = `sha256:${"2".repeat(64)}`; expect(assemble("preactivate", imageValue).run.status).toBe(1); });
  it("rejects a fabricated DB success on the static path", () => { const value = bootstrap("prebuild"); value.checks.schemaContract = true; expect(assemble("prebuild", value).run.status).toBe(1); });
});
