import { createHash } from "node:crypto";
import { DISCOVERY_STAGE_BOUNDARIES } from "@repo/contracts/discovery-execution";

/** Sorted object keys preserve authored array order; presentation labels are excluded from criteria. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "label").sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => [key, canonical(v)]));
  return value;
}

export function discoveryCriteriaDigest(tests: Record<string, unknown>[]): string {
  const fields = tests.map(test => ({ assumptionId: test.assumptionId, targetRung: test.targetRung,
    pass: test.pass, fail: test.fail, minSample: test.minSample }));
  return createHash("sha256").update(JSON.stringify(canonical(fields))).digest("hex");
}

export class DiscoveryStageValidationError extends Error {
  readonly code = "WORKFLOW_DISCOVERY_CONTENT_INVALID";
  constructor(readonly reason: string) { super(`W027 content invalid: ${reason}`); }
}

/** A language model is not a cryptographic calculator. The server freezes its validated criteria. */
export function freezeDiscoveryPlan(raw: Record<string, unknown>): Record<string, unknown> {
  const shape = DISCOVERY_STAGE_BOUNDARIES.hypothesize.omit({ criteriaDigest: true });
  const parsed = shape.safeParse(raw);
  if (!parsed.success) throw new DiscoveryStageValidationError("stage_schema_invalid:hypothesize");
  const criteriaDigest = discoveryCriteriaDigest(parsed.data.tests);
  if (raw.criteriaDigest !== undefined && raw.criteriaDigest !== criteriaDigest) {
    throw new DiscoveryStageValidationError("criteria_digest_invalid");
  }
  return { ...parsed.data, criteriaDigest };
}

export function validateDiscoveryStage(stageId: string, output: unknown, prior: Readonly<Record<string, unknown>>): void {
  const schema = DISCOVERY_STAGE_BOUNDARIES[stageId as keyof typeof DISCOVERY_STAGE_BOUNDARIES];
  if (!schema) throw new DiscoveryStageValidationError("stage_unknown");
  if (!schema.safeParse(output).success) throw new DiscoveryStageValidationError(`stage_schema_invalid:${stageId}`);
  if (stageId === "hypothesize") {
    const plan = DISCOVERY_STAGE_BOUNDARIES.hypothesize.parse(output);
    if (discoveryCriteriaDigest(plan.tests) !== plan.criteriaDigest) throw new DiscoveryStageValidationError("criteria_digest_invalid");
    const assumptions = new Set(plan.assumptions.map(a => a.assumptionId));
    if (plan.tests.some(test => !assumptions.has(test.assumptionId))) throw new DiscoveryStageValidationError("test_assumption_missing");
  }
  if (stageId === "adjudicate") {
    const readout = DISCOVERY_STAGE_BOUNDARIES.adjudicate.parse(output);
    const plan = DISCOVERY_STAGE_BOUNDARIES.hypothesize.parse(prior.hypothesize);
    const synthesis = DISCOVERY_STAGE_BOUNDARIES.synthesize.parse(prior.synthesize);
    if (readout.planId !== plan.planId || readout.planVersion !== plan.planVersion || readout.synthesisId !== synthesis.synthesisId) {
      throw new DiscoveryStageValidationError("readout_reference_mismatch");
    }
  }
  if (stageId === "map") {
    const map = DISCOVERY_STAGE_BOUNDARIES.map.parse(output);
    const frame = DISCOVERY_STAGE_BOUNDARIES.frame.parse(prior.frame);
    const synthesis = DISCOVERY_STAGE_BOUNDARIES.synthesize.parse(prior.synthesize);
    if (map.root.frameId !== frame.frameId || map.root.frameVersion !== frame.version ||
      !map.evidenceBasis.synthesisIds.includes(synthesis.synthesisId) ||
      !map.opportunities.some(opportunity => opportunity.oppId === map.decision.proposedTarget)) {
      throw new DiscoveryStageValidationError("map_reference_or_target_mismatch");
    }
  }
}
