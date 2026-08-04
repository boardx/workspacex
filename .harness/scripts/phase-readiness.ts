import { loadFeatureList } from "./lib/features";
import { req, type Args } from "./lib/args";
import { die, log } from "./lib/log";
import {
  loadEvidenceProof,
  loadPhaseReadiness,
  savePhaseReadiness,
  validateTargetCommit,
} from "./lib/phase-readiness-fs";
import {
  evaluateReadyTransition,
  type EvidenceProof,
  type PhaseReadiness,
  type ReadinessEvidenceKind,
  type ReadinessFeature,
} from "./lib/phase-readiness";

type ProofResult = { ok: true; proof: EvidenceProof } | { ok: false; error: string };

export interface PhaseReadinessDependencies {
  now(): Date;
  fail(message: string): never;
  loadCurrent(phase: string): PhaseReadiness;
  save(state: PhaseReadiness): void;
  validateTarget(commit: string): string | null;
  loadProof(path: string, expected: { phase: string; kind: ReadinessEvidenceKind }): ProofResult;
  loadFeatures(phase: string): readonly ReadinessFeature[];
}

const DEFAULT_DEPENDENCIES: PhaseReadinessDependencies = {
  now: () => new Date(),
  fail: die,
  loadCurrent: loadPhaseReadiness,
  save: savePhaseReadiness,
  validateTarget: validateTargetCommit,
  loadProof: loadEvidenceProof,
  loadFeatures: (phase) => loadFeatureList(phase).features,
};

export function phaseReadiness(args: Args, dependencies: PhaseReadinessDependencies = DEFAULT_DEPENDENCIES): void {
  const phase = req(args, "phase");
  const current = dependencies.loadCurrent(phase);
  const to = args.opts["to"];
  if (!to) {
    log.info(JSON.stringify(current, null, 2));
    return;
  }
  const actor = req(args, "actor");
  const at = dependencies.now().toISOString();
  if (to === "not_ready") {
    const reason = req(args, "reason").trim();
    if (reason.length < 10) dependencies.fail("--reason 至少 10 个字符，降级必须留下可审计原因");
    const next: PhaseReadiness = {
      schema_version: 1,
      phase,
      status: "not_ready",
      reason,
      assessed_at: at,
      assessed_by: actor,
      target_commit: null,
      evidence: { runtime: null, e2e: null },
    };
    dependencies.save(next);
    log.ok(`Phase ${phase} runtime/E2E readiness → not_ready（feature status 未改变）`);
    return;
  }
  if (to !== "ready") dependencies.fail("--to 只允许 ready 或 not_ready");
  const targetCommit = req(args, "target-commit");
  const targetError = dependencies.validateTarget(targetCommit);
  if (targetError) dependencies.fail(targetError);
  const runtime = dependencies.loadProof(req(args, "runtime-evidence"), { phase, kind: "runtime" });
  if (!runtime.ok) dependencies.fail(runtime.error);
  const e2e = dependencies.loadProof(req(args, "e2e-evidence"), { phase, kind: "e2e" });
  if (!e2e.ok) dependencies.fail(e2e.error);
  const result = evaluateReadyTransition({
    phase,
    features: dependencies.loadFeatures(phase),
    actor,
    targetCommit,
    at,
    runtime: runtime.proof,
    e2e: e2e.proof,
  });
  if (!result.ok) dependencies.fail(`Phase ${phase} 不能转为 ready：\n- ${result.reasons.join("\n- ")}`);
  dependencies.save(result.state);
  log.ok(`Phase ${phase} runtime/E2E readiness → ready @ ${targetCommit.slice(0, 8)}（feature status 未改变）`);
}
