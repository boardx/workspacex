import { z } from "zod";
import { requiredReleaseImages, validateReleaseManifest, type ReleaseExecutor, type ReleaseProfile } from "./release.js";

/** Ask running containers, not only the image cache, which release is actually deployed. */
export async function verifyRunningRelease(input: unknown, profile: ReleaseProfile, containerIds: Record<string, string>, execute: ReleaseExecutor) {
  const manifest = validateReleaseManifest(input);
  const expected: Array<{ service: string; image: string }> = requiredReleaseImages(manifest, profile);
  // Native sessions and one-shot tools use the same sandbox image but distinct containers.
  expected.push({ service: "sandbox-sessions", image: manifest.images.sandbox.image });
  const checked: string[] = [];
  for (const item of expected) {
    const service = item.service;
    const id = containerIds[service];
    if (!id || !/^[a-f0-9]{12,64}$/.test(id)) throw new Error(`RUNNING_CONTAINER_REQUIRED: ${service}`);
    try {
      const imageId = z.string().regex(/^sha256:[a-f0-9]{64}$/).parse(JSON.parse(await execute(["docker", "image", "inspect", "--format", "{{json .Id}}", item.image])));
      // Request only non-secret fields; Docker's full inspection includes Config.Env.
      const format = '[{{json .Image}},{{json .Config.Image}},{{json (index .Config.Labels "com.docker.compose.service")}},{{json .State.Running}},{{json .State.Restarting}},{{json .State.OOMKilled}}]';
      const actual = z.tuple([z.string(), z.string(), z.string(), z.boolean(), z.boolean(), z.boolean()]).parse(JSON.parse(await execute(["docker", "container", "inspect", "--format", format, id])));
      if (actual[0] !== imageId || actual[1] !== item.image || actual[2] !== service || !actual[3] || actual[4] || actual[5]) throw new Error("mismatch");
    } catch { throw new Error(`RUNNING_RELEASE_MISMATCH: ${service}`); }
    checked.push(service);
  }
  return { release: manifest.release, checked, businessVerified: false as const };
}
