import { z } from "zod";
import { canonicalDockerReference } from "./image-reference.js";
import { releaseManifestSchema, type ReleaseExecutor, type ReleaseManifest } from "./release.js";

const applicationImages = releaseManifestSchema.shape.images.pick({
  web: true,
  api: true,
  agent: true,
  sandbox: true,
});

/** The production artifact published to ACR. It is a projection of ReleaseManifest,
 * so the release identity and image rules continue to have one schema source. */
export const acrProductionReleaseManifestSchema = releaseManifestSchema
  .pick({ schemaVersion: true, release: true, sourceRevision: true, platform: true })
  .extend({ images: applicationImages })
  .strict();

export type AcrProductionReleaseManifest = z.infer<typeof acrProductionReleaseManifestSchema>;

const repositoryPrefixSchema = z.string().max(253).regex(
  /^[a-z0-9][a-z0-9.-]*(?::[0-9]+)?\/[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
);

function normalizedPrefix(repositoryPrefix: string) {
  return `${canonicalDockerReference(repositoryPrefix.replace(/\/$/, ""))}/`;
}

/** Derive the four-image production artifact from the canonical release manifest. */
export function createAcrProductionReleaseManifest(
  releaseInput: unknown,
  repositoryPrefixInput: unknown,
): AcrProductionReleaseManifest {
  const release = releaseManifestSchema.parse(releaseInput);
  const repositoryPrefix = repositoryPrefixSchema.parse(repositoryPrefixInput);
  const manifest = acrProductionReleaseManifestSchema.parse({
    schemaVersion: release.schemaVersion,
    release: release.release,
    sourceRevision: release.sourceRevision,
    platform: release.platform,
    images: {
      web: release.images.web,
      api: release.images.api,
      agent: release.images.agent,
      sandbox: release.images.sandbox,
    },
  });
  return validateAcrProductionReleaseManifest(manifest, repositoryPrefix);
}

/** Reject images outside the newly provisioned ACR namespace. */
export function validateAcrProductionReleaseManifest(
  input: unknown,
  repositoryPrefixInput: unknown,
): AcrProductionReleaseManifest {
  const result = acrProductionReleaseManifestSchema.safeParse(input);
  if (!result.success) throw new Error("INVALID_ACR_PRODUCTION_RELEASE_MANIFEST");
  const prefix = normalizedPrefix(repositoryPrefixSchema.parse(repositoryPrefixInput));
  for (const [service, artifact] of Object.entries(result.data.images)) {
    if (!canonicalDockerReference(artifact.image).startsWith(prefix)) {
      throw new Error(`ACR_IMAGE_OUTSIDE_NAMESPACE: ${service}`);
    }
  }
  return result.data;
}

/** Network preparation that must finish before the five-minute provision clock. */
export async function prepareAcrProductionRelease(
  input: unknown,
  repositoryPrefixInput: unknown,
  execute: ReleaseExecutor,
) {
  const manifest = validateAcrProductionReleaseManifest(input, repositoryPrefixInput);
  const checked: string[] = [];
  for (const [service, artifact] of Object.entries(manifest.images)) {
    try {
      await execute(["docker", "pull", "--platform", manifest.platform, artifact.image]);
    } catch {
      throw new Error(`ACR_IMAGE_PULL_FAILED: ${service}`);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(await execute(["docker", "image", "inspect", artifact.image]));
    } catch {
      throw new Error(`ACR_IMAGE_INSPECTION_FAILED: ${service}`);
    }
    const inspection = z.array(z.object({
      Os: z.string(),
      Architecture: z.string(),
      RepoDigests: z.array(z.string()),
      Config: z.object({ Labels: z.record(z.string()).nullable().optional() }),
    })).length(1).safeParse(raw);
    if (!inspection.success) throw new Error(`INVALID_ACR_IMAGE_INSPECTION: ${service}`);
    const image = inspection.data[0]!;
    if (!image.RepoDigests.map(canonicalDockerReference).includes(canonicalDockerReference(artifact.image))) {
      throw new Error(`ACR_IMAGE_DIGEST_MISMATCH: ${service}`);
    }
    if (`${image.Os}/${image.Architecture}` !== manifest.platform) {
      throw new Error(`ACR_IMAGE_PLATFORM_MISMATCH: ${service}`);
    }
    if (image.Config.Labels?.["org.opencontainers.image.revision"] !== manifest.sourceRevision) {
      throw new Error(`ACR_IMAGE_REVISION_MISMATCH: ${service}`);
    }
    checked.push(service);
  }
  return { release: manifest.release, sourceRevision: manifest.sourceRevision, checked, cloudVerified: false as const };
}

export function asCanonicalReleaseManifest(
  production: AcrProductionReleaseManifest,
  base: ReleaseManifest,
): ReleaseManifest {
  if (production.release !== base.release || production.sourceRevision !== base.sourceRevision || production.platform !== base.platform) {
    throw new Error("ACR_RELEASE_IDENTITY_MISMATCH");
  }
  return { ...base, images: { ...base.images, ...production.images } };
}
