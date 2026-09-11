import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createCloudCompose } from "../src/compose.js";
import { deploymentExample } from "../src/examples.js";

const directory = mkdtempSync(join(tmpdir(), "cloud-compose-"));
try {
  const image = { image: `registry.example/app/runtime@sha256:${"a".repeat(64)}` };
  for (const profile of ["starter", "production"] as const) {
    const config = deploymentExample(profile);
    const release = { schemaVersion: 1, release: config.provision.release, sourceRevision: "b".repeat(40), platform: "linux/amd64", images: { web: image, api: image, agent: image, sandbox: image, postgres: image, redis: image } };
    for (const service of ["web", "api", "agent", "postgres"]) writeFileSync(join(directory, `${service}.env`), "PROBE_PASSWORD=a$b${NOT_EXPANDED}\n", { mode: 0o600 });
    const compose = createCloudCompose(config, release, { projectName: "cloud-compose-check", runtimeDirectory: directory });
    const path = join(directory, "compose.json");
    writeFileSync(path, JSON.stringify(compose));
    const actual = JSON.parse(execFileSync("docker", ["compose", "-f", path, "config", "--format", "json"], { encoding: "utf8", timeout: 15_000 }));
    // Compose escapes dollars when serializing its reusable canonical model.
    assert.equal(actual.services.api.environment.PROBE_PASSWORD, "a$$b$${NOT_EXPANDED}");
    assert.equal(actual.services.api.environment.WORKSPACEX_OBJECT_STORE, "oss");
    assert.equal(Boolean(actual.services.postgres), profile === "starter");
    assert.equal(Boolean(actual.services.redis), profile === "starter");
    assert.equal(actual.services.sandbox.network_mode, "none");
    for (const service of Object.values(actual.services) as Array<Record<string, unknown>>) { assert.equal(service.pull_policy, "never"); assert.equal(service.build, undefined); }
    const runtimeImage = process.argv[2];
    if (runtimeImage) {
      if (!/^[a-z0-9./_-]+@sha256:[a-f0-9]{64}$/.test(runtimeImage)) throw new Error("Cached runtime fixture image must use digest");
      const platform = execFileSync("docker", ["image", "inspect", "--format", "{{.Os}}/{{.Architecture}}", runtimeImage], { encoding: "utf8", timeout: 15_000 }).trim();
      const fixture = { name: `cloud-raw-check-${process.pid}`, services: { api: { ...compose.services.api, image: runtimeImage, platform, volumes: [], ports: [], network_mode: "none", mem_limit: "96m", cpus: 0.1 } } };
      writeFileSync(path, JSON.stringify(fixture));
      try {
        execFileSync("docker", ["compose", "-f", path, "run", "--rm", "--no-deps", "--pull", "never", "api", "node", "-e", "require('node:assert/strict').equal(process.env.PROBE_PASSWORD,'a$b${NOT_EXPANDED}')"], { stdio: "pipe", timeout: 30_000 });
      } finally {
        execFileSync("docker", ["compose", "-f", path, "down", "--remove-orphans"], { stdio: "pipe", timeout: 15_000 });
      }
      process.stdout.write(`${profile}: raw env value preserved in actual network-disabled container\n`);
    }
    // Counterexample: corrupt the generated runtime configuration and ensure Compose rejects it.
    writeFileSync(path, JSON.stringify({ ...compose, services: { ...compose.services, api: { ...compose.services.api, pull_policy: "invalid-policy" } } }));
    assert.throws(() => execFileSync("docker", ["compose", "-f", path, "config", "--quiet"], { stdio: "pipe", timeout: 15_000 }));
    process.stdout.write(`${profile}: compose parsed; raw secrets preserved; invalid policy rejected\n`);
  }
} finally { rmSync(directory, { recursive: true, force: true }); }
