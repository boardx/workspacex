import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createCloudCompose } from "../src/compose.js";
import { deploymentExample } from "../src/examples.js";
import type { ReleaseManifest } from "../src/release.js";
const image = { image: `registry.example/app/runtime@sha256:${"a".repeat(64)}` };
function release(version: string): ReleaseManifest { return { schemaVersion: 1, release: version, sourceRevision: "b".repeat(40), platform: "linux/amd64", images: { web: image, api: image, agent: image, sandbox: image, postgres: image, redis: image } }; }
describe("cloud compose", () => {
  it.each(["starter", "production"] as const)("locks %s runtime to prewarmed images and OSS", profile => {
    const config = deploymentExample(profile);
    const compose = createCloudCompose(config, release(config.provision.release), { projectName: "cloud-test", runtimeDirectory: "/opt/cloud" });
    for (const service of Object.values(compose.services)) { expect(service.pull_policy).toBe("never"); expect(service).not.toHaveProperty("build"); }
    expect(compose.services.api!.environment).toMatchObject({ WORKSPACEX_OBJECT_STORE: "oss", WORKSPACEX_DEPLOY_PROFILE: profile });
    expect(compose.services.agent).toMatchObject({ user: "1000:1000", cap_drop: ["ALL"] });
    expect(Boolean(compose.services.postgres)).toBe(profile === "starter");
    expect(Boolean(compose.services.redis)).toBe(profile === "starter");
    for (const name of ["sandbox", "sandbox-sessions"]) expect(compose.services[name]).toMatchObject({ network_mode: "none", read_only: true, cap_drop: ["ALL"], pids_limit: 128 });
  });
  it("rejects mismatched release and unsafe mount paths", () => {
    const config = deploymentExample("starter");
    expect(() => createCloudCompose(config, release("9.9.9"), { projectName: "test", runtimeDirectory: "/opt/cloud" })).toThrow("RELEASE_VERSION_MISMATCH");
    expect(() => createCloudCompose(config, release(config.provision.release), { projectName: "test", runtimeDirectory: "/opt/${SECRET}" })).toThrow();
  });
});

it("promotes one image set across environment configs without rebuilding", () => {
  const dev = deploymentExample("production");
  dev.environment.publicUrl = "https://devapp.example.com";
  const cn = deploymentExample("production");
  cn.environment.publicUrl = "https://workspace.example.cn";
  cn.environment.ossBucket = "workspacex-cn-example";
  const bundle = release(dev.provision.release);
  const before = JSON.stringify(bundle);
  const first = createCloudCompose(dev, bundle, { projectName: "devapp", runtimeDirectory: "/opt/devapp/runtime" });
  const second = createCloudCompose(cn, bundle, { projectName: "production-cn", runtimeDirectory: "/opt/cn/runtime" });
  for (const service of ["web", "api", "agent", "sandbox", "sandbox-sessions"]) {
    expect(first.services[service]!.image).toBe(second.services[service]!.image);
    expect(first.services[service]).not.toHaveProperty("build");
    expect(second.services[service]).not.toHaveProperty("build");
  }
  expect(first.services.web!.env_file).not.toEqual(second.services.web!.env_file);
  expect(first.services.api!.environment).not.toEqual(second.services.api!.environment);
  expect(JSON.stringify(bundle)).toBe(before);
});

it('both sandbox services load an optional stable capacity file without weakening isolation or duplicating runtime defaults', () => {
  const config=deploymentExample('production');
  const compose=createCloudCompose(config,release(config.provision.release),{projectName:'capacity-test',runtimeDirectory:'/opt/runtime'});
  for(const service of ['sandbox','sandbox-sessions']) {
    expect(compose.services[service]!.env_file).toEqual([{path:'/etc/workspacex/sandbox-capacity.env',required:false,format:'raw'}]);
    expect(compose.services[service]).toMatchObject({network_mode:'none',read_only:true,mem_limit:'1g',cpus:1});
    expect(compose.services[service]!.environment).not.toHaveProperty('SKILL_SANDBOX_CONCURRENCY');
    for (const file of ['scripts/image_install/templates/compose.json','deploy/us/compose.yaml']) {
      const template=JSON.parse(readFileSync(new URL('../../../'+file,import.meta.url),'utf8'));
      expect(template.services[service].env_file).toEqual(compose.services[service]!.env_file);
    }
  }
});
