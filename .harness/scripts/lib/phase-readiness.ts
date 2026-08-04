import type { FeatureStatus } from "./types";

export type PhaseReadinessStatus = "not_ready" | "ready";
export type ReadinessEvidenceKind = "runtime" | "e2e";

export interface ReadinessFeature {
  id: string;
  status: FeatureStatus;
}

export interface ReadinessEvidenceManifest {
  schema_version: 1;
  phase: string;
  kind: ReadinessEvidenceKind;
  command: string;
  exit_code: 0;
  commit: string;
  recorded_at: string;
  artifacts: string[];
}

export interface EvidenceRef {
  path: string;
  sha256: string;
}

export interface EvidenceProof extends EvidenceRef {
  manifest: ReadinessEvidenceManifest;
}

export interface PhaseReadiness {
  schema_version: 1;
  phase: string;
  status: PhaseReadinessStatus;
  reason: string;
  assessed_at: string | null;
  assessed_by: string | null;
  target_commit: string | null;
  evidence: {
    runtime: EvidenceRef | null;
    e2e: EvidenceRef | null;
  };
}

export interface ReadyTransitionInput {
  phase: string;
  features: readonly ReadinessFeature[];
  actor: string;
  targetCommit: string;
  at: string;
  runtime: EvidenceProof | null;
  e2e: EvidenceProof | null;
}

export type ReadyTransitionResult =
  | { ok: true; state: PhaseReadiness }
  | { ok: false; reasons: string[] };

export interface ReadinessAudit {
  status: PhaseReadinessStatus;
  fails: string[];
  warns: string[];
}

const COMMIT_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIso(value: string): boolean {
  return !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

export function createInitialPhaseReadiness(phase: string): PhaseReadiness {
  return {
    schema_version: 1,
    phase,
    status: "not_ready",
    reason: "runtime/E2E evidence has not been accepted",
    assessed_at: null,
    assessed_by: null,
    target_commit: null,
    evidence: { runtime: null, e2e: null },
  };
}

export function parseEvidenceManifest(
  raw: unknown,
  expected: { phase: string; kind: ReadinessEvidenceKind },
): { ok: true; value: ReadinessEvidenceManifest } | { ok: false; errors: string[] } {
  if (!isRecord(raw)) return { ok: false, errors: ["manifest must be an object"] };
  const errors: string[] = [];
  if (raw["schema_version"] !== 1) errors.push("schema_version must equal 1");
  if (raw["phase"] !== expected.phase) errors.push(`phase must equal ${expected.phase}`);
  if (raw["kind"] !== expected.kind) errors.push(`kind must equal ${expected.kind}`);
  if (typeof raw["command"] !== "string" || raw["command"].trim().length === 0)
    errors.push("command must be non-empty");
  else if (/^\s*(?:echo|printf)\b|\|\|\s*true\b/i.test(raw["command"]))
    errors.push("command must not be a placeholder or suppress failure");
  if (raw["exit_code"] !== 0) errors.push("exit_code must equal 0");
  if (typeof raw["commit"] !== "string" || !COMMIT_RE.test(raw["commit"]))
    errors.push("commit must be a 40-character lowercase git SHA");
  if (typeof raw["recorded_at"] !== "string" || !isIso(raw["recorded_at"]))
    errors.push("recorded_at must be canonical ISO 8601");
  if (!Array.isArray(raw["artifacts"]) || raw["artifacts"].length === 0 ||
      raw["artifacts"].some((item) => typeof item !== "string" || item.trim().length === 0))
    errors.push("artifacts must contain at least one non-empty path");
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: raw as unknown as ReadinessEvidenceManifest };
}

function evidenceReasons(
  proof: EvidenceProof | null,
  kind: ReadinessEvidenceKind,
  phase: string,
  targetCommit: string,
): string[] {
  if (!proof) return [`${kind} evidence is required`];
  const errors: string[] = [];
  if (!SHA256_RE.test(proof.sha256)) errors.push("sha256 must be 64 lowercase hex characters");
  const manifest = parseEvidenceManifest(proof.manifest, { phase, kind });
  if (!manifest.ok) errors.push(...manifest.errors);
  else if (manifest.value.commit !== targetCommit)
    errors.push(`manifest commit ${manifest.value.commit} does not match target ${targetCommit}`);
  return errors.map((reason) => `${kind} evidence invalid: ${reason}`);
}

function featureGateReason(features: readonly ReadinessFeature[]): string | null {
  const passing = features.filter((feature) => feature.status === "passing").length;
  if (features.length > 0 && passing === features.length) return null;
  const remainder = new Map<FeatureStatus, number>();
  for (const feature of features) {
    if (feature.status !== "passing") remainder.set(feature.status, (remainder.get(feature.status) ?? 0) + 1);
  }
  const detail = [...remainder.entries()].map(([status, count]) => `${count} still ${status}`).join("; ");
  return `feature gate failed: ${passing}/${features.length} passing${detail ? `; ${detail}` : ""}`;
}

export function evaluateReadyTransition(input: ReadyTransitionInput): ReadyTransitionResult {
  const reasons: string[] = [];
  const featureReason = featureGateReason(input.features);
  if (featureReason) reasons.push(featureReason);
  if (!input.actor.trim()) reasons.push("actor is required");
  if (!COMMIT_RE.test(input.targetCommit)) reasons.push("target commit must be a 40-character lowercase git SHA");
  if (!isIso(input.at)) reasons.push("assessment time must be canonical ISO 8601");
  reasons.push(...evidenceReasons(input.runtime, "runtime", input.phase, input.targetCommit));
  reasons.push(...evidenceReasons(input.e2e, "e2e", input.phase, input.targetCommit));
  if (reasons.length > 0) return { ok: false, reasons };
  return {
    ok: true,
    state: {
      schema_version: 1,
      phase: input.phase,
      status: "ready",
      reason: "runtime and E2E gates passed",
      assessed_at: input.at,
      assessed_by: input.actor,
      target_commit: input.targetCommit,
      evidence: {
        runtime: { path: input.runtime!.path, sha256: input.runtime!.sha256 },
        e2e: { path: input.e2e!.path, sha256: input.e2e!.sha256 },
      },
    },
  };
}

export function parsePhaseReadiness(
  raw: unknown,
  expectedPhase: string,
): { ok: true; value: PhaseReadiness } | { ok: false; errors: string[] } {
  if (!isRecord(raw)) return { ok: false, errors: ["readiness document must be an object"] };
  const errors: string[] = [];
  if (raw["schema_version"] !== 1) errors.push("schema_version must equal 1");
  if (raw["phase"] !== expectedPhase) errors.push(`phase must equal ${expectedPhase}`);
  if (raw["status"] !== "not_ready" && raw["status"] !== "ready") errors.push("status must be not_ready or ready");
  if (typeof raw["reason"] !== "string" || raw["reason"].trim().length < 10) errors.push("reason must be at least 10 characters");
  const evidence = raw["evidence"];
  if (!isRecord(evidence)) {
    errors.push("evidence must be an object");
  } else if (raw["status"] === "ready") {
    if (typeof raw["assessed_at"] !== "string" || !isIso(raw["assessed_at"]))
      errors.push("ready assessed_at must be canonical ISO 8601");
    if (typeof raw["assessed_by"] !== "string" || raw["assessed_by"].trim().length === 0)
      errors.push("ready assessed_by must be non-empty");
    if (typeof raw["target_commit"] !== "string" || !COMMIT_RE.test(raw["target_commit"]))
      errors.push("ready target_commit must be a full SHA");
    for (const kind of ["runtime", "e2e"] as const) {
      const ref = evidence[kind];
      if (!isRecord(ref) || typeof ref["path"] !== "string" || ref["path"].trim().length === 0 ||
          typeof ref["sha256"] !== "string" || !SHA256_RE.test(ref["sha256"]))
        errors.push(`ready ${kind} evidence reference is required`);
    }
  } else if (raw["status"] === "not_ready") {
    if (raw["target_commit"] !== null || evidence["runtime"] !== null || evidence["e2e"] !== null)
      errors.push("not_ready must not retain target_commit or evidence references");
    if (raw["assessed_at"] !== null && (typeof raw["assessed_at"] !== "string" || !isIso(raw["assessed_at"])))
      errors.push("not_ready assessed_at must be null or canonical ISO 8601");
    if (raw["assessed_by"] !== null && (typeof raw["assessed_by"] !== "string" || raw["assessed_by"].trim().length === 0))
      errors.push("not_ready assessed_by must be null or non-empty");
  }
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: raw as unknown as PhaseReadiness };
}

export function auditPhaseReadiness(
  state: PhaseReadiness,
  features: readonly ReadinessFeature[],
  proofs: readonly EvidenceProof[],
): ReadinessAudit {
  if (state.status === "not_ready") {
    const passing = features.filter((feature) => feature.status === "passing").length;
    return {
      status: "not_ready",
      fails: [],
      warns: [`runtime/E2E NOT READY: ${passing}/${features.length} features passing; passing count is not readiness`],
    };
  }
  const proofFor = (kind: ReadinessEvidenceKind): EvidenceProof | null => {
    const ref = state.evidence[kind];
    if (!ref) return null;
    return proofs.find((proof) => proof.path === ref.path && proof.sha256 === ref.sha256) ?? null;
  };
  const result = evaluateReadyTransition({
    phase: state.phase,
    features,
    actor: state.assessed_by ?? "",
    targetCommit: state.target_commit ?? "",
    at: state.assessed_at ?? "",
    runtime: proofFor("runtime"),
    e2e: proofFor("e2e"),
  });
  return result.ok
    ? { status: "ready", fails: [], warns: [] }
    : { status: "ready", fails: result.reasons.map((reason) => `ready is invalid: ${reason}`), warns: [] };
}
