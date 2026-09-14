import { createHash } from "node:crypto";
import { z } from "zod";
import { validateReleaseManifest } from "./release.js";

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

export const sealedReleaseCandidateSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.literal("sealed"),
  sourceRevision: sha,
  manifestSha256: sha256,
  sealedAt: z.string().datetime(),
}).strict();

export type SealedReleaseCandidate = z.infer<typeof sealedReleaseCandidateSchema>;

export function sealReleaseCandidate(manifestBytes: Buffer, sealedAt = new Date()): SealedReleaseCandidate {
  const manifest = validateReleaseManifest(JSON.parse(manifestBytes.toString("utf8")));
  return sealedReleaseCandidateSchema.parse({
    schemaVersion: 1,
    status: "sealed",
    sourceRevision: manifest.sourceRevision,
    manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
    sealedAt: sealedAt.toISOString(),
  });
}

export function verifySealedReleaseCandidate(sealInput: unknown, manifestBytes: Buffer, expectedRevision?: string) {
  const seal = sealedReleaseCandidateSchema.parse(sealInput);
  const manifest = validateReleaseManifest(JSON.parse(manifestBytes.toString("utf8")));
  const digest = createHash("sha256").update(manifestBytes).digest("hex");
  if (seal.sourceRevision !== manifest.sourceRevision || seal.manifestSha256 !== digest) throw new Error("RELEASE_CANDIDATE_MANIFEST_MISMATCH");
  if (expectedRevision && seal.sourceRevision !== sha.parse(expectedRevision)) throw new Error("RELEASE_CANDIDATE_REVISION_MISMATCH");
  return { seal, manifest };
}
