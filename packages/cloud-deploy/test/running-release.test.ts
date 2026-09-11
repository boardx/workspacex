import { expect, it } from "vitest";
import { verifyRunningRelease } from "../src/running-release.js";
const image = { image: `registry.example/app/runtime@sha256:${"a".repeat(64)}` };
const manifest = { schemaVersion: 1, release: "1.0.0", sourceRevision: "b".repeat(40), platform: "linux/amd64", images: { web: image, api: image, agent: image, sandbox: image, postgres: image, redis: image } };
const ids = Object.fromEntries(["web", "api", "agent", "sandbox", "sandbox-sessions"].map((key, index) => [key, String(index + 1).repeat(64)]));
const service = (argv: readonly string[]) => Object.keys(ids).find(key => ids[key] === argv.at(-1))!;
const imageId = `sha256:${"d".repeat(64)}`;
it("checks live container image identity and state without claiming business readiness", async () => {
  const result = await verifyRunningRelease(manifest, "production", ids, async argv => JSON.stringify(argv[1] === "image" ? imageId : [imageId, image.image, service(argv), true, false, false]));
  expect(result.checked).toHaveLength(5);
  expect(result.businessVerified).toBe(false);
});
it.each(["old-image", "stopped", "restarting", "oom"])("rejects %s live runtime", async defect => {
  await expect(verifyRunningRelease(manifest, "production", ids, async argv => JSON.stringify(argv[1] === "image" ? imageId : [defect === "old-image" ? "old" : imageId, image.image, service(argv), defect !== "stopped", defect === "restarting", defect === "oom"]))).rejects.toThrow("RUNNING_RELEASE_MISMATCH");
});
