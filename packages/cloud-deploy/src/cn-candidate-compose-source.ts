import { z } from "zod";
import { createCloudCompose } from "./compose.js";
import { deploymentConfigSchema } from "./config.js";
import { validateReleaseManifest } from "./release.js";

/** The supplement emitter is restricted to the reviewed frozen maintenance APP. */
export const CANDIDATE_COMPOSE_APP = "9b25bfa65662b96c0826fe67506b562ea46aa6d0";
const requestSchema = z.object({
  schemaVersion: z.literal(1),
  sourceRevision: z.literal(CANDIDATE_COMPOSE_APP),
  config: z.unknown(), manifest: z.unknown(),
  options: z.object({projectName:z.string(),runtimeDirectory:z.string()}).strict(),
}).strict();

/** Pure native renderer. Callers must authenticate protected refs before invoking it. */
export function emitCandidateComposeSource(input: unknown) {
  const request = requestSchema.parse(input);
  const config = deploymentConfigSchema.parse(request.config);
  const manifest = validateReleaseManifest(request.manifest);
  if (config.environment.profile !== "production" || manifest.sourceRevision !== CANDIDATE_COMPOSE_APP ||
      manifest.release !== "2026.10.3-cn.1" || manifest.platform !== "linux/amd64") {
    throw new Error("CANDIDATE_COMPOSE_FIXED_APP_REQUIRED");
  }
  // Exact native writeRuntimeBundle rule in frozen APP runtime-bundle.ts.
  return {...createCloudCompose(config,manifest,request.options),
    networks:{default:{external:true,name:`${request.options.projectName}-runtime`}}};
}
