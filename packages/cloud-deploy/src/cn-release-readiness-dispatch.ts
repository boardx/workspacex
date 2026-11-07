import { createHash } from "node:crypto";
import { prepareHost, prepareHostOptionsSchema, type PrepareHostOptions, type PrepareHostServices } from "./prepare-host";
import { verifyPreparedHost } from "./verify-prepared-host";
import { deploymentConfigSchema } from "./config";
import { validateReleaseManifest, verifyPrewarmedRelease } from "./release";

/** Preparation only. This receipt cannot skip any backup, admission, hotfix,
 * writer authorization or business gate in the durable production driver. */
export async function dispatchCnReleaseReadiness(input: {
  lane: "prepared" | "artifact-ready" | "cold";
  change: "normal" | "hotfix";
  sourceRevision: string; baselineSha256: string;
  config: unknown; options: PrepareHostOptions;
  manifestBytes?: Buffer;
  prepared?: { manifestSha256: string; baselineSha256: string; expiresAt: string };
}, boundary: {
  buildArtifacts: () => Promise<Buffer>;
  readBaseline: () => Promise<string>;
  services: PrepareHostServices & { run: NonNullable<PrepareHostServices["run"]> };
  source?: NodeJS.ProcessEnv;
  now?: () => number;
}) {
  const config = deploymentConfigSchema.parse(input.config);
  const options = prepareHostOptionsSchema.parse(input.options);
  const {runtimeDirectory:dir,checkoutDirectory:checkout}=options;
  const overlaps=(a:string,b:string)=>a===b||a.startsWith(b+"/")||b.startsWith(a+"/");
  if(overlaps(dir,checkout)||(config.environment.profile==="starter"&&overlaps(dir,config.environment.dataVolumePath)))throw new Error("PREPARE_DIRECTORIES_OVERLAP");
  const now = boundary.now ?? Date.now;
  const earlier = (reason: string) => ({status:"requires-earlier-stage" as const, next:"artifact-ready" as const, reason, productionReady:false as const});
  if (!/^[a-f0-9]{40}$/.test(input.sourceRevision) || !/^[a-f0-9]{64}$/.test(input.baselineSha256)
      || !["prepared","artifact-ready","cold"].includes(input.lane) || !["normal","hotfix"].includes(input.change)) throw new Error("READINESS_IDENTITY_REQUIRED");
  if (await boundary.readBaseline() !== input.baselineSha256) throw new Error("READINESS_BASELINE_DRIFT");
  let bytes = input.manifestBytes;
  if (input.lane === "prepared") {
    const p = input.prepared;
    if (!p || !Number.isFinite(Date.parse(p.expiresAt))) throw new Error("PREPARED_BINDING_REQUIRED");
    if (p.baselineSha256 !== input.baselineSha256) throw new Error("PREPARED_BASELINE_DRIFT");
    if (Date.parse(p.expiresAt) <= now()) return earlier("PREPARATION_EXPIRED");
    if (!bytes || createHash("sha256").update(bytes).digest("hex") !== p.manifestSha256) throw new Error("PREPARED_MANIFEST_DRIFT");
  } else if (input.lane === "cold") {
    // Exactly one explicit external build. Unknown outcomes propagate; never retry.
    if (bytes) throw new Error("COLD_ARTIFACT_AMBIGUOUS");
    bytes = await boundary.buildArtifacts();
  }
  if (!bytes || bytes.length > 65536) throw new Error("ARTIFACT_MANIFEST_REQUIRED");
  const manifest = validateReleaseManifest(JSON.parse(bytes.toString("utf8")));
  if (manifest.sourceRevision !== input.sourceRevision) throw new Error("ARTIFACT_SOURCE_DRIFT");
  if (input.lane !== "prepared") await prepareHost(input.config,manifest,input.options,boundary.services,boundary.source);
  const imageDeadline = Date.now()+15000;
  const context = {signal:AbortSignal.timeout(15000),remainingMs:()=>Math.max(0,imageDeadline-Date.now())};
  await verifyPrewarmedRelease(manifest,config.environment.profile,argv=>boundary.services.run(argv,context));
  const integrity = await verifyPreparedHost(input.config,manifest,input.options,boundary.services.run,boundary.source);
  if (await boundary.readBaseline() !== input.baselineSha256) throw new Error("READINESS_BASELINE_DRIFT");
  if (input.lane === "prepared" && Date.parse(input.prepared!.expiresAt) <= now()) return earlier("PREPARATION_EXPIRED");
  return {status:"preparation-integrity-verified" as const, lane:input.lane, change:input.change,
    sourceRevision:input.sourceRevision, baselineSha256:input.baselineSha256,
    manifestSha256:createHash("sha256").update(bytes).digest("hex"), ...integrity,
    productionReady:false as const, backupVerified:false as const, shadowVerified:false as const,
    requiredNext:"original-durable-release-admission" as const};
}
