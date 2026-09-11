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
