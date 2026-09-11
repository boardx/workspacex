import { z } from "zod";
import { canonicalDockerReference } from "./image-reference.js";
import { releaseManifestSchema, validateReleaseManifest, verifyPrewarmedRelease, type ReleaseExecutor } from "./release.js";
const reference = z.string().regex(/^[a-z0-9][a-z0-9.-]*(?::[0-9]+)?\/[a-z0-9]+(?:[._/-][a-z0-9]+)*(?::[A-Za-z0-9_][A-Za-z0-9_.-]*|@sha256:[a-f0-9]{64})$/);
const entry = z.object({ image: reference }).strict();
const inputSchema = releaseManifestSchema.omit({ images: true }).extend({
  images: z.object({ web: entry, api: entry, agent: entry, sandbox: entry, postgres: entry, redis: entry }).strict(),
});

/** Resolve actual published digests. Local image IDs are never substituted for registry digests. */
export async function createReleaseManifest(input: unknown, execute: ReleaseExecutor) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new Error("INVALID_RELEASE_BUILD_INPUT");
  const manifest = structuredClone(parsed.data);
  for (const [service, artifact] of Object.entries(manifest.images)) {
    const image = artifact.image;
    let digests: string[];
    try { digests = z.array(z.string()).parse(JSON.parse(await execute(["docker", "image", "inspect", "--format", "{{json .RepoDigests}}", image]))); }
    catch { throw new Error(`RELEASE_DIGEST_UNAVAILABLE: ${service}`); }
    const canonicalImage = canonicalDockerReference(image);
    const repository = canonicalImage.includes("@") ? canonicalImage.split("@")[0]! : canonicalImage.slice(0, canonicalImage.lastIndexOf(":"));
    const matches = [...new Set(digests.map(canonicalDockerReference).filter(digest => digest.startsWith(`${repository}@sha256:`) && (!canonicalImage.includes("@") || digest === canonicalImage)))];
    if (matches.length !== 1) throw new Error(`RELEASE_DIGEST_NOT_UNIQUE: ${service}`);
    artifact.image = matches[0]!;
  }
  const result = validateReleaseManifest(manifest);
  // Validate all six artifacts even when the first deployment will use external DB/Redis.
  await verifyPrewarmedRelease(result, "starter", execute);
  for (const [service, artifact] of Object.entries(result.images)) {
    let registry: string;
    try { registry = await execute(["docker", "buildx", "imagetools", "inspect", artifact.image]); }
    catch { throw new Error(`RELEASE_REGISTRY_UNAVAILABLE: ${service}`); }
    const expectedDigest = artifact.image.slice(artifact.image.indexOf("@") + 1);
    const actualDigest = registry.match(/^Digest:\s+(sha256:[a-f0-9]{64})\s*$/m)?.[1];
    if (actualDigest !== expectedDigest) throw new Error(`RELEASE_REGISTRY_DIGEST_MISMATCH: ${service}`);
  }
  return result;
}
