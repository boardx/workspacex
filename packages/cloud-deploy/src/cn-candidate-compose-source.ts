import { z } from "zod";
import { createCloudCompose } from "./compose.js";
import { deploymentConfigSchema } from "./config.js";
import { validateReleaseManifest } from "./release.js";
import { assertSourcePlanAuthority, type OriginalPlanAuthority } from "./cn-maintenance-host/source_plan_authority.js";
import { runtimeDigest } from "./cn-maintenance-host/sealed_runtime.js";

/** Historical fixture revision; never an admission authority. */
export const CANDIDATE_COMPOSE_APP = "9b25bfa65662b96c0826fe67506b562ea46aa6d0";
const requestSchema = z.object({
  schemaVersion: z.literal(1), sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
  config: z.unknown(), manifest: z.unknown(),
  options: z.object({projectName:z.string(),runtimeDirectory:z.string()}).strict(),
}).strict();

/** Source-owned caller supplies independently issued authority and pinned manifest. */
export function emitCandidateComposeSource(input: unknown, authority: OriginalPlanAuthority, approvedManifest: unknown) {
  const request = requestSchema.parse(input);
  assertSourcePlanAuthority(authority, authority?.identity, authority?.toolRevision);
  const config = deploymentConfigSchema.parse(request.config);
  const manifest = validateReleaseManifest(request.manifest);
  const approved = validateReleaseManifest(approvedManifest);
  if (config.environment.profile !== "production" || request.sourceRevision !== authority.identity.sourceRevision ||
      manifest.sourceRevision !== authority.identity.sourceRevision || approved.sourceRevision !== authority.identity.sourceRevision ||
      runtimeDigest(manifest) !== runtimeDigest(approved) || config.provision.release !== approved.release ||
      manifest.platform !== "linux/amd64") throw new Error("CANDIDATE_COMPOSE_APPROVED_SOURCE_REQUIRED");
  return {...createCloudCompose(config,manifest,request.options),
    networks:{default:{external:true,name:`${request.options.projectName}-runtime`}}};
}
