import { loadFeatureList } from "./lib/features";
import { req, type Args } from "./lib/args";
import { die, log } from "./lib/log";
import {
  loadEvidenceProof,
  loadPhaseReadiness,
  savePhaseReadiness,
  validateTargetCommit,
} from "./lib/phase-readiness-fs";
import { evaluateReadyTransition, type PhaseReadiness } from "./lib/phase-readiness";

export function phaseReadiness(args: Args): void {
  const phase = req(args, "phase");
  const current = loadPhaseReadiness(phase);
  const to = args.opts["to"];
  if (!to) {
    log.info(JSON.stringify(current, null, 2));
    return;
  }
  const actor = req(args, "actor");
  const at = new Date().toISOString();
  if (to === "not_ready") {
    const reason = req(args, "reason").trim();
    if (reason.length < 10) die("--reason 至少 10 个字符，降级必须留下可审计原因");
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
    savePhaseReadiness(next);
    log.ok(`Phase ${phase} runtime/E2E readiness → not_ready（feature status 未改变）`);
    return;
  }
  if (to !== "ready") die("--to 只允许 ready 或 not_ready");
  const targetCommit = req(args, "target-commit");
  const targetError = validateTargetCommit(targetCommit);
  if (targetError) die(targetError);
  const runtime = loadEvidenceProof(req(args, "runtime-evidence"), { phase, kind: "runtime" });
  if (!runtime.ok) die(runtime.error);
  const e2e = loadEvidenceProof(req(args, "e2e-evidence"), { phase, kind: "e2e" });
  if (!e2e.ok) die(e2e.error);
  const result = evaluateReadyTransition({
    phase,
    features: loadFeatureList(phase).features,
    actor,
    targetCommit,
    at,
    runtime: runtime.proof,
    e2e: e2e.proof,
  });
  if (!result.ok) die(`Phase ${phase} 不能转为 ready：\n- ${result.reasons.join("\n- ")}`);
  savePhaseReadiness(result.state);
  log.ok(`Phase ${phase} runtime/E2E readiness → ready @ ${targetCommit.slice(0, 8)}（feature status 未改变）`);
}
