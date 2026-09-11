import { z } from "zod";

const digestImage = z.string().max(512).regex(/^[a-z0-9][a-z0-9.-]*(?::[0-9]+)?\/[a-z0-9]+(?:[._/-][a-z0-9]+)*@sha256:[a-f0-9]{64}$/);
const artifact = z.object({ image: digestImage }).strict();
export const releaseManifestSchema = z.object({
  schemaVersion: z.literal(1),
  release: z.string().regex(/^v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/),
  sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
  platform: z.enum(["linux/amd64", "linux/arm64"]),
  images: z.object({ web: artifact, api: artifact, agent: artifact, sandbox: artifact, postgres: artifact, redis: artifact }).strict(),
}).strict();
export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;
export type ReleaseProfile = "starter" | "production";
export type ReleaseService = keyof ReleaseManifest["images"];

export function validateReleaseManifest(input: unknown): ReleaseManifest {
  const result = releaseManifestSchema.safeParse(input);
  if (!result.success) throw new Error(`INVALID_RELEASE_MANIFEST: ${[...new Set(result.error.issues.map(issue => issue.path.join(".")))].join(", ")}`);
  return result.data;
}

export function requiredReleaseImages(manifest: ReleaseManifest, profile: ReleaseProfile) {
  const services: ReleaseService[] = ["web", "api", "agent", "sandbox"];
  if (profile === "starter") services.push("postgres", "redis");
  return services.map(service => ({ service, image: manifest.images[service].image }));
}

export type ReleaseExecutor = (argv: readonly string[]) => Promise<string>;

/** Checks the local Docker daemon, never the registry. No pull/build is permitted here. */
export async function verifyPrewarmedRelease(manifestInput: unknown, profile: ReleaseProfile, execute: ReleaseExecutor) {
  const manifest = validateReleaseManifest(manifestInput);
  const checked: ReleaseService[] = [];
  for (const { service, image } of requiredReleaseImages(manifest, profile)) {
    let raw: unknown;
    try { raw = JSON.parse(await execute(["docker", "image", "inspect", image])); }
    catch { throw new Error(`RELEASE_IMAGE_UNAVAILABLE: ${service}`); }
    const inspection = z.array(z.object({
      Os: z.string(), Architecture: z.string(), RepoDigests: z.array(z.string()),
      Config: z.object({ Labels: z.record(z.string()).nullable().optional() }),
    })).length(1).safeParse(raw);
    if (!inspection.success) throw new Error(`INVALID_IMAGE_INSPECTION: ${service}`);
    const actual = inspection.data[0]!;
    if (!actual.RepoDigests.includes(image)) throw new Error(`IMAGE_DIGEST_MISMATCH: ${service}`);
    if (`${actual.Os}/${actual.Architecture}` !== manifest.platform) throw new Error(`IMAGE_PLATFORM_MISMATCH: ${service}`);
    if (!["postgres", "redis"].includes(service) && actual.Config.Labels?.["org.opencontainers.image.revision"] !== manifest.sourceRevision) {
      throw new Error(`IMAGE_REVISION_MISMATCH: ${service}`);
    }
    checked.push(service);
  }
  return { release: manifest.release, sourceRevision: manifest.sourceRevision, checked, cloudVerified: false as const };
}

/** Explicit preparation only: network downloads finish before the provision timer begins. */
export async function prewarmRelease(manifestInput: unknown, profile: ReleaseProfile, execute: ReleaseExecutor) {
  const manifest = validateReleaseManifest(manifestInput);
  for (const { service, image } of requiredReleaseImages(manifest, profile)) {
    try { await execute(["docker", "pull", "--platform", manifest.platform, image]); }
    catch { throw new Error(`IMAGE_PREWARM_FAILED: ${service}`); }
  }
  return verifyPrewarmedRelease(manifest, profile, execute);
}
