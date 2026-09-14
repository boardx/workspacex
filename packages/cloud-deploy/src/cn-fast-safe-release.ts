import { z } from "zod";
import { createHash } from "node:crypto";
import { validateReleaseManifest } from "./release";

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const terminalCheck = z.object({ status:z.literal("passed"), evidenceSha256:sha256 }).strict();
const failureClass = z.enum(["stale-test", "infrastructure", "product", "unknown"]);
const waiverSchema = z.object({
  issueUrl: z.string().url().regex(/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/[1-9][0-9]*$/),
  evidenceSha256: sha256,
  owner: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/),
  expiresAt: z.string().datetime(),
}).strict();
const releaseFailureSchema = z.object({
  check: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/),
  classification: failureClass,
  waiver: waiverSchema.optional(),
}).strict();
const durableConfigSchema = z.object({
  asrProfile: z.literal(true),
  platformSuperuserEmails: z.literal(true),
  githubIssueProfile: z.literal(true),
  copilotkitExactTimeoutSeconds: z.number().int().min(3600).max(3600),
  copilotkitPrefixTimeoutSeconds: z.number().int().min(3600).max(3600),
}).strict();
const diffSchema = z.object({
  migrationRisk: z.enum(["none", "compatible", "destructive"]),
  changedServices: z.array(z.enum(["web", "api", "agent", "sandbox"])).max(4),
}).strict();
const imageSetSchema = z.object({ web: digest, api: digest, agent: digest, sandbox: digest }).strict();

export const preparedCnReleaseSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.literal("prepared").default("prepared"),
  sourceRevision: sha,
  baselineSha256: sha256,
  release: z.string().regex(/^v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/),
  manifestSha256: sha256,
  images: imageSetSchema,
  diff: diffSchema,
  durableConfig: durableConfigSchema,
  checks: z.object({
    sourceFrozen: terminalCheck,
    imagesImmutable: terminalCheck,
    canonicalConfigRendered: terminalCheck,
    migrationAssessed: terminalCheck,
    databaseBackup: terminalCheck,
    shadowReadiness: terminalCheck,
    shadowBusiness: terminalCheck,
  }).strict(),
  failures: z.array(releaseFailureSchema).max(128),
  preparedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
}).strict().superRefine((value, context) => {
  const prepared = Date.parse(value.preparedAt), expires = Date.parse(value.expiresAt);
  if (expires <= prepared || expires - prepared > 7 * 86_400_000) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAt"], message: "INVALID_PREPARATION_WINDOW" });
  }
  if (value.diff.migrationRisk === "destructive") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["diff", "migrationRisk"], message: "DESTRUCTIVE_MIGRATION_REQUIRES_MAINTENANCE_LANE" });
  }
  for (const [index, failure] of value.failures.entries()) {
    if (failure.waiver && Date.parse(failure.waiver.expiresAt) > expires) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["failures", index, "waiver", "expiresAt"], message: "WAIVER_OUTLIVES_PREPARATION" });
    }
  }
});
export type PreparedCnRelease = z.infer<typeof preparedCnReleaseSchema>;
export type ReleaseFailure = z.infer<typeof releaseFailureSchema>;

export function validatePreparedCnRelease(input: unknown): PreparedCnRelease {
  const result = preparedCnReleaseSchema.safeParse(input);
  if (!result.success) throw new Error("INVALID_PREPARED_CN_RELEASE");
  return result.data;
}

export function verifyPreparedReleaseManifest(receiptInput: unknown, manifestBytes: Buffer) {
  const receipt=validatePreparedCnRelease(receiptInput);
  let manifest;
  try { manifest=validateReleaseManifest(JSON.parse(manifestBytes.toString("utf8"))); }
  catch { throw new Error("PREPARED_MANIFEST_INVALID"); }
  if (manifest.sourceRevision !== receipt.sourceRevision || createHash("sha256").update(manifestBytes).digest("hex") !== receipt.manifestSha256) throw new Error("PREPARED_MANIFEST_MISMATCH");
  for (const service of ["web","api","agent","sandbox"] as const) {
    if (manifest.images[service].image.split("@").at(-1) !== receipt.images[service]) throw new Error("PREPARED_IMAGE_MISMATCH");
  }
  return manifest;
}

export function classifyReleaseFailures(failures: readonly ReleaseFailure[], now = new Date()) {
  const blocked: string[] = [], waived: string[] = [];
  for (const failure of failures) {
    const eligible = failure.classification === "stale-test" || failure.classification === "infrastructure";
    const validWaiver = eligible && failure.waiver && Date.parse(failure.waiver.expiresAt) > now.getTime();
    (validWaiver ? waived : blocked).push(failure.check);
  }
  return { blocked, waived };
}

export interface PreparationActions {
  freezeSource(): Promise<string>;
  buildImmutableImages(): Promise<z.infer<typeof imageSetSchema>>;
  renderCanonicalConfig(): Promise<z.infer<typeof durableConfigSchema>>;
  assessDiff(): Promise<z.infer<typeof diffSchema>>;
  verifyDatabaseBackup(): Promise<"passed">;
  runShadowChecks(): Promise<{ shadowReadiness: "passed"; shadowBusiness: "passed" }>;
}
const gate=(value:unknown)=>({status:"passed" as const,evidenceSha256:createHash("sha256").update(JSON.stringify(value)).digest("hex")});

export async function createPreparedCnRelease(input: {
  sourceRevision: string; baselineSha256: string; release: string; manifestSha256: string;
  preparedAt: string; expiresAt: string; failures?: ReleaseFailure[];
}, actions: PreparationActions): Promise<PreparedCnRelease> {
  const frozen = await actions.freezeSource();
  if (frozen !== input.sourceRevision) throw new Error("SOURCE_FREEZE_MISMATCH");
  const [images, durableConfig, diff, databaseBackup, shadow] = await Promise.all([
    actions.buildImmutableImages(), actions.renderCanonicalConfig(), actions.assessDiff(), actions.verifyDatabaseBackup(), actions.runShadowChecks(),
  ]);
  const receipt = validatePreparedCnRelease({
    schemaVersion: 1, status: "prepared", ...input, failures: input.failures ?? [], images, durableConfig, diff,
    checks: {
      sourceFrozen: gate(frozen), imagesImmutable: gate(images), canonicalConfigRendered: gate(durableConfig),
      migrationAssessed: gate(diff), databaseBackup: gate(databaseBackup),
      shadowReadiness: gate(shadow.shadowReadiness), shadowBusiness: gate(shadow.shadowBusiness),
    },
  });
  const classification = classifyReleaseFailures(receipt.failures, new Date(receipt.preparedAt));
  if (classification.blocked.length) throw new Error("PREPARATION_GATES_BLOCKED");
  return receipt;
}

export interface ActivationActions {
  readBaselineFingerprint(): Promise<string>;
  drainRuns(): Promise<{ queued: number; running: number; writebackPending: number }>;
  promotePreparedPointer(): Promise<void>;
  activateTraffic(): Promise<void>;
  verifyCanonical(): Promise<{ status: "passed" | "failed"; lockRetained: boolean; passedStages: number }>;
  runBrowserSmoke(): Promise<{ login: boolean; hello: boolean; asr: boolean; githubFeedbackRead: boolean; skillTool: boolean; pdfDownload: boolean }>;
  restoreBaseline(): Promise<void>;
  restorePointer(): Promise<void>;
}
export interface ActivationReport {
  status: "passed" | "blocked" | "rolled-back" | "rollback-unproven";
  code: string;
  durationMs: number;
}

/** Activation consumes only an immutable preparation receipt. Error details are never
 * copied into the report because provider and command errors may contain credentials. */
export async function activatePreparedCnRelease(input: unknown, actions: ActivationActions, options: { now?: Date; deadlineMs?: number } = {}): Promise<ActivationReport> {
  const receipt = validatePreparedCnRelease(input), now = options.now ?? new Date(), deadlineMs = options.deadlineMs ?? 300_000;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > 300_000) throw new Error("INVALID_ACTIVATION_DEADLINE");
  const started = performance.now();
  const report = (status: ActivationReport["status"], code: string): ActivationReport => ({ status, code, durationMs: Math.round(performance.now() - started) });
  if (Date.parse(receipt.expiresAt) <= now.getTime()) return report("blocked", "PREPARATION_EXPIRED");
  if (classifyReleaseFailures(receipt.failures, now).blocked.length) return report("blocked", "PREPARATION_GATES_BLOCKED");
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), deadlineMs);
  let promoted = false;
  const active = () => { if (controller.signal.aborted || performance.now() - started >= deadlineMs) throw new Error("ACTIVATION_DEADLINE_EXCEEDED"); };
  try {
    if (await actions.readBaselineFingerprint() !== receipt.baselineSha256) return report("blocked", "BASELINE_CAS_MISMATCH");
    const drain = await actions.drainRuns(); active();
    if ([drain.queued, drain.running, drain.writebackPending].some(value => !Number.isSafeInteger(value) || value !== 0)) return report("blocked", "RUN_DRAIN_INCOMPLETE");
    await actions.promotePreparedPointer(); promoted = true; active();
    await actions.activateTraffic(); active();
    const canonical = await actions.verifyCanonical(); active();
    if (canonical.status !== "passed" || canonical.lockRetained || canonical.passedStages !== 8) throw new Error("CANONICAL_GATE_FAILED");
    const browser = await actions.runBrowserSmoke(); active();
    if (!Object.values(browser).every(value => value === true)) throw new Error("BROWSER_SMOKE_FAILED");
    return report("passed", "ACTIVATED");
  } catch (error) {
    if (!promoted) return report("blocked", "ACTIVATION_PRECONDITION_FAILED");
    const code = error instanceof Error && ["CANONICAL_GATE_FAILED", "BROWSER_SMOKE_FAILED"].includes(error.message) ? error.message : "ACTIVATION_FAILED";
    try {
      await actions.restoreBaseline();
      await actions.restorePointer();
      return report("rolled-back", code);
    } catch {
      return report("rollback-unproven", code);
    }
  } finally {
    clearTimeout(timer);
  }
}
