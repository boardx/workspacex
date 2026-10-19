import { createHash } from "node:crypto";
import { z } from "zod";
import { classifyReleaseFailures, verifyPreparedReleaseManifest, validatePreparedCnRelease } from "./cn-fast-safe-release";
import { verifyPrewarmedRelease } from "./release";
import { verifyRunningRelease } from "./running-release";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.string().regex(/^[a-f0-9]{40}$/);
const image = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const appServices = ["api", "web", "agent", "sandbox", "sandbox-sessions"] as const;
const changedServices = ["api", "web"] as const;
const proof = z.object({ status: z.literal("passed"), evidenceSha256: sha }).strict();
export const appOnlyInputSchema = z.object({
  schemaVersion: z.literal(1), mode: z.literal("app-only"), sourceRevision: revision,
  baselineSourceRevision: revision, attemptId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
  baselineSha256: sha, runtimeConfigSha256: sha,
  // Produced before admission by the existing trusted preparation process, never
  // inferred from an empty SQL diff or supplied through workflow boolean inputs.
  compatibility: z.object({ schemaUnchanged: proof, startupMutationFree: proof,
    backwardReadWrite: proof, unchangedEnvironmentAndSecurity: proof }).strict(),
  requestedAt: z.string().datetime(), observedAt: z.string().datetime(), expiresAt: z.string().datetime(),
}).strict();
export const baselineSchema = z.object({ schemaVersion: z.literal(1), composeFile: z.string().regex(/^\/var\/lib\/workspacex-cn\/runtime\/[a-f0-9]{40}\/compose.json$/),
  images: z.object({ api: image, web: image, agent: image, sandbox: image }).strict(), nginxSha256: sha }).strict();
export function appContainerImage(value: unknown, service: string, composeFile: string) {
  const row = z.tuple([image, z.literal(true), z.literal("workspacex-cn"), z.enum(appServices),
    z.literal(false), z.literal(false), z.string()]).parse(value);
  requireValue(row[3] === service && row[6] === composeFile, "APP_ONLY_LIVE_CONTAINER_CONFIG");
  return row[0];
}
export type AppOnlyMode = "activate" | "rollback" | "commit" | "verify" | "check";
export type AppOnlyBinding = {
  sourceRevision: string; attemptId: string; requestSha256: string; preparedSha256: string; manifestSha256: string;
};
/** Reconcile only the exact durable attempt. Committed state survives marker
 * removal; it authorizes readonly verification, never a second activation. */
export function appOnlyOperation(mode: AppOnlyMode, marker: unknown, state: unknown, binding: AppOnlyBinding) {
  const committed = typeof state === "object" && state !== null && "status" in state && state.status === "committed";
  if (mode === "activate") {
    requireValue(marker === undefined, "APP_ONLY_INFLIGHT");
    requireValue(!committed, "APP_ONLY_ALREADY_COMMITTED");
    return "activate";
  }
  const operation = mode === "commit" || (mode === "check" && (marker !== undefined || committed)) ? "verify" : mode;
  if (mode === "rollback" || operation === "verify") {
    const intent = marker ?? (mode !== "rollback" && committed ? state : undefined);
    requireValue(typeof intent === "object" && intent !== null, "APP_ONLY_INTENT_REQUIRED");
    requireValue(Object.entries(binding).every(([key, value]) => (intent as Record<string, unknown>)[key] === value), "APP_ONLY_INTENT_MISMATCH");
  }
  return operation;
}
export type AppContext = { signal: AbortSignal; remainingMs: () => number };
export interface AppOnlyIO {
  signal?: AbortSignal;
  verifyHost(context: AppContext): Promise<void>;
  execute(argv: readonly string[], context: AppContext): Promise<string>;
  snapshot(context: AppContext): Promise<{ baselineBytes: Buffer; nginxBytes: Buffer; runtimeConfigSha256: string }>;
  configuration(context: AppContext): Promise<{ nginxBytes: Buffer; runtimeConfigSha256: string }>;
  writeImages(images: Record<string, string>): Promise<void>;
  smoke(context: AppContext): Promise<void>;
  record(status: "switching" | "activated" | "rolled-back" | "uncertain"): Promise<void>;
}
const digest = (raw: Buffer) => createHash("sha256").update(raw).digest("hex");
/** Bind existing, independently produced compatibility evidence into the existing
 * prepared receipt. This does not collect, manufacture or approve that evidence. */
export function bindAppOnlyPreparation(prepared: unknown, requestBytes: Buffer) {
  const receipt = validatePreparedCnRelease(prepared);
  const request = appOnlyInputSchema.parse(JSON.parse(requestBytes.toString("utf8")));
  requireValue(receipt.sourceRevision === request.sourceRevision && receipt.baselineSha256 === request.baselineSha256 &&
    receipt.diff.migrationRisk === "none" && receipt.diff.pendingMigrationCount === 0 &&
    receipt.diff.changedServices.every(s => s === "api" || s === "web"), "APP_ONLY_PREPARATION_SCOPE");
  return validatePreparedCnRelease({ ...receipt, checks: { ...receipt.checks,
    migrationAssessed: { status: "passed", evidenceSha256: digest(requestBytes) } } });
}
export function baselineFingerprint(files: readonly Buffer[]) {
  const hash = createHash("sha256");
  for (const raw of files) hash.update(`${raw.length}:${digest(raw)}\n`);
  return hash.digest("hex");
}
function context(budget: number, parent?: AbortSignal) {
  const started = performance.now(), controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);
  const cancel = () => controller.abort();
  parent?.addEventListener("abort", cancel, { once: true });
  if (parent?.aborted) cancel();
  return { value: { signal: controller.signal, remainingMs: () => Math.max(0, budget - performance.now() + started) },
    close: () => { clearTimeout(timer); parent?.removeEventListener("abort", cancel); } };
}
function requireValue(ok: unknown, code: string): asserts ok { if (!ok) throw new Error(code); }

/** The shared host release lock and normal frozen-tag approval remain owned by
 * the existing dispatcher/workflow. No provision, secret rendering or host setup.
 * The baseline Compose is reused; only api/web image fields can vary.
 */
export async function switchAppOnly(input: unknown, prepared: unknown, manifestBytes: Buffer,
  baselineBytes: Buffer, baselineNginx: Buffer, io: AppOnlyIO,
  operation: "activate" | "rollback" | "verify" | "check" = "activate", now = new Date()) {
  const requestBytes = Buffer.isBuffer(input) ? input : Buffer.from(JSON.stringify(input));
  const request = appOnlyInputSchema.parse(JSON.parse(requestBytes.toString("utf8")));
  const manifest = verifyPreparedReleaseManifest(prepared, manifestBytes);
  const receipt = prepared as { sourceRevision: string; baselineSha256: string; expiresAt: string;
    diff: { migrationRisk: string; pendingMigrationCount: number }; failures: Parameters<typeof classifyReleaseFailures>[0];
    checks: { migrationAssessed: { evidenceSha256: string } } };
  const baseline = baselineSchema.parse(JSON.parse(baselineBytes.toString("utf8")));
  requireValue(manifest.sourceRevision === request.sourceRevision && receipt.baselineSha256 === request.baselineSha256,
    "APP_ONLY_IDENTITY_MISMATCH");
  requireValue(baselineFingerprint([baselineBytes, baselineNginx]) === request.baselineSha256 && digest(baselineNginx) === baseline.nginxSha256,
    "APP_ONLY_BASELINE_MISMATCH");
  requireValue(receipt.diff.migrationRisk === "none" && receipt.diff.pendingMigrationCount === 0 &&
    (prepared as { diff: { changedServices: string[] } }).diff.changedServices.every(s => s === "api" || s === "web") &&
    (["rollback", "verify"].includes(operation) || classifyReleaseFailures(receipt.failures, now).blocked.length === 0), "APP_ONLY_COMPATIBILITY_UNKNOWN");
  requireValue(receipt.checks.migrationAssessed.evidenceSha256 === digest(requestBytes), "APP_ONLY_REQUEST_NOT_FROZEN");
  const observed = Date.parse(request.observedAt), expiry = Date.parse(request.expiresAt);
  const requested = Date.parse(request.requestedAt);
  requireValue(observed <= now.getTime() && expiry > observed && expiry - observed <= 3600000 &&
    requested <= observed && expiry - requested <= 1800000, "APP_ONLY_EVIDENCE_EXPIRED");
  if (operation === "activate" || operation === "check") requireValue(expiry > now.getTime() && Date.parse(receipt.expiresAt) > now.getTime(), "APP_ONLY_EVIDENCE_EXPIRED");
  if (operation === "activate") requireValue(expiry - now.getTime() > 120000, "APP_ONLY_WINDOW_EXHAUSTED");
  const compose = ["docker", "compose", "--project-name", "workspacex-cn", "--file", baseline.composeFile];
  const target = { api: manifest.images.api.image, web: manifest.images.web.image };
  const previous = { api: baseline.images.api, web: baseline.images.web };
  const apply = async (images: Record<string, string>, ctx: AppContext) => {
    requireValue(!ctx.signal.aborted && ctx.remainingMs() > 0, "APP_ONLY_DEADLINE");
    await io.writeImages(images);
    await io.execute([...compose, "up", "--detach", "--no-deps", "--no-build", "--pull", "never", ...changedServices], ctx);
  };
  const unchanged = async (ctx: AppContext) => {
    const live = await io.snapshot(ctx);
    const actual = baselineSchema.parse(JSON.parse(live.baselineBytes.toString()));
    requireValue(actual.images.agent === baseline.images.agent && actual.images.sandbox === baseline.images.sandbox &&
      digest(live.nginxBytes) === baseline.nginxSha256 && live.runtimeConfigSha256 === request.runtimeConfigSha256,
    "APP_ONLY_UNCHANGED_SERVICES_OR_CONFIG_DRIFT");
  };
  const ensureBaseline = async (ctx: AppContext) => {
    const live = await io.snapshot(ctx);
    requireValue(baselineFingerprint([live.baselineBytes, live.nginxBytes]) === request.baselineSha256 &&
      live.runtimeConfigSha256 === request.runtimeConfigSha256, "APP_ONLY_LIVE_BASELINE_DRIFT");
  };
  const rollback = async () => {
    const recovery = context(120000);
    try {
      await io.verifyHost(recovery.value);
      // Config/TLS/DB are never restored or overwritten. Refuse configuration drift.
      const live = await io.configuration(recovery.value);
      requireValue(digest(live.nginxBytes) === baseline.nginxSha256 &&
        live.runtimeConfigSha256 === request.runtimeConfigSha256, "APP_ONLY_ROLLBACK_CONFIG_DRIFT");
      await apply(previous, recovery.value);
      for (const service of changedServices) {
        const id = (await io.execute([...compose, "ps", "--quiet", service], recovery.value)).trim();
        requireValue(/^[a-f0-9]{12,64}$/.test(id), "APP_ONLY_ROLLBACK_CONTAINER_MISSING");
        const raw = await io.execute(["docker", "container", "inspect", "--format", "[{{json .Image}},{{json .State.Running}},{{json .State.Restarting}},{{json .State.OOMKilled}}]", id], recovery.value);
        const state = z.tuple([z.string(), z.boolean(), z.boolean(), z.boolean()]).parse(JSON.parse(raw));
        requireValue(state[0] === previous[service] && state[1] && !state[2] && !state[3], "APP_ONLY_ROLLBACK_IMAGE_MISMATCH");
      }
      await unchanged(recovery.value);
      await io.smoke(recovery.value);
      await io.record("rolled-back");
    } catch { await io.record("uncertain"); throw new Error("APP_ONLY_ROLLBACK_UNPROVEN"); }
    finally { recovery.close(); }
  };
  if (operation === "rollback") { await rollback(); return { status: "rolled-back", fullBusinessAcceptance: false }; }
  const phaseStarted = performance.now();
  const activation = context(operation === "verify" ? 120000 : Math.min(300000, expiry - now.getTime() - (operation === "activate" ? 120000 : 0)), io.signal);
  let switching = false;
  try {
    await io.verifyHost(activation.value);
    if (operation !== "verify") await ensureBaseline(activation.value);
    for (const service of operation === "verify" ? [] : changedServices) {
      const label = await io.execute(["docker", "image", "inspect", "--format", '{{json (index .Config.Labels "org.opencontainers.image.revision")}}', baseline.images[service]], activation.value);
      requireValue(JSON.parse(label) === request.baselineSourceRevision, "APP_ONLY_BASELINE_SOURCE_MISMATCH");
    }
    for (const service of ["agent", "sandbox"] as const) {
      const id = await io.execute(["docker", "image", "inspect", "--format", "{{json .Id}}", manifest.images[service].image], activation.value);
      requireValue(JSON.parse(id) === baseline.images[service], "APP_ONLY_UNCHANGED_IMAGE_MISMATCH");
    }
    await verifyPrewarmedRelease(manifest, "production", argv => io.execute(argv, activation.value), "web-api");
    if (operation === "check") return { status: "ready", fullBusinessAcceptance: false };
    if (operation !== "verify") {
      await io.record("switching"); switching = true;
      await apply(target, activation.value);
    }
    const ids: Record<string, string> = {};
    for (const service of changedServices) ids[service] = (await io.execute([...compose, "ps", "--quiet", service], activation.value)).trim();
    await verifyRunningRelease(manifest, "production", ids, argv => io.execute(argv, activation.value), "web-api");
    await unchanged(activation.value);
    await io.smoke(activation.value);
    requireValue(!activation.value.signal.aborted && activation.value.remainingMs() > 0, "APP_ONLY_DEADLINE");
    if (operation !== "verify") await io.record("activated");
    const checkedAt = now.getTime() + performance.now() - phaseStarted;
    return operation === "verify"
      ? { status: "verified", publicationWindowOpen: Date.parse(receipt.expiresAt) > checkedAt && expiry > checkedAt, publicationDeadline: new Date(Math.min(expiry, Date.parse(receipt.expiresAt))).toISOString(), fullBusinessAcceptance: false }
      : { status: "activated", fullBusinessAcceptance: false };
  } catch {
    activation.close();
    if (switching) await rollback();
    throw new Error(switching ? "APP_ONLY_ACTIVATION_FAILED_ROLLED_BACK" : "APP_ONLY_NOT_READY");
  } finally { activation.close(); }
}
