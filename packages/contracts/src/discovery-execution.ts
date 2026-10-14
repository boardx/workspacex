import { z } from "zod";

const id = z.string().min(1);
const version = z.number().int().positive();
const criterion = z.object({ metric: id, op: z.enum([">=", ">", "<=", "<"]),
  numerator: z.number().int().nonnegative(), denominator: z.number().int().positive() }).passthrough();

/** Runtime-consumed boundaries from authored S061/S062/S009/S063/S064/S065.
 * These checks do not certify the full professional method or the truth of model claims.
 */
export const DiscoveryPlanBoundary = z.object({
  planId: id, planVersion: version, criteriaDigest: z.string().regex(/^[0-9a-f]{64}$/),
  outcome: z.object({ status: z.literal("anchored"), actor: id, behavior: id }).passthrough(),
  assumptions: z.array(z.object({ assumptionId: id, text: id, selected: z.boolean() }).passthrough()).min(1),
  tests: z.array(z.object({ testId: id, assumptionId: id, targetRung: id,
    pass: criterion, fail: criterion, minSample: z.object({ unit: id, n: z.number().int().positive() }),
    evidenceOwner: z.enum(["S062", "S009", "external"]) }).passthrough()).min(1),
}).passthrough();
export const DiscoveryInterviewPlanBoundary = z.object({ planId: id, status: z.literal("ready-for-review"),
  researchQuestions: z.array(z.object({ questionId: id, text: id }).passthrough()).min(1),
}).passthrough();
export const DiscoveryCorpusBoundary = z.object({ packId: id,
  corpus: z.array(z.object({ segmentId: id }).passthrough()).min(1),
}).passthrough();
export const DiscoverySynthesisBoundary = z.object({ synthesisId: id, status: z.literal("provisional"),
  findings: z.array(z.object({ findingId: id, questionId: id, claim: id,
    supportingEvidenceIds: z.array(id).min(1) }).passthrough()).min(1),
}).passthrough();
export const DiscoveryReadoutBoundary = z.object({ planId: id, planVersion: version, synthesisId: id,
  synthesisStatus: z.literal("provisional"), discoveryState: z.enum(["continue-provisional", "pivot"]),
  verdicts: z.array(z.object({ testId: id, assumptionId: id,
    result: z.enum(["supported", "refuted", "inconclusive", "untested"]), findingIds: z.array(id) }).passthrough()).min(1),
}).passthrough();
export const DiscoveryFrameBoundary = z.object({ frameId: id, version, status: z.literal("draft"), statement: id }).passthrough();
export const DiscoveryMapBoundary = z.object({ mapId: id, version,
  root: z.object({ frameId: id, frameVersion: version }).passthrough(),
  evidenceBasis: z.object({ synthesisIds: z.array(id).min(1), anyProvisional: z.literal(true) }).passthrough(),
  opportunities: z.array(z.object({ oppId: id, statement: id }).passthrough()).min(1),
  decision: z.object({ status: z.literal("proposed"), proposedTarget: id }).passthrough(),
}).passthrough();

export const DISCOVERY_STAGE_BOUNDARIES = {
  hypothesize: DiscoveryPlanBoundary, plan_interviews: DiscoveryInterviewPlanBoundary,
  gather: DiscoveryCorpusBoundary, synthesize: DiscoverySynthesisBoundary,
  adjudicate: DiscoveryReadoutBoundary, frame: DiscoveryFrameBoundary, map: DiscoveryMapBoundary,
} as const;

export const DiscoveryOutlineResult = z.object({ outlineId: id, status: z.literal("pending_confirm") }).passthrough();
export const DiscoveryFieldworkResult = z.object({
  sessions: z.array(z.object({ interviewRecordRef: id, stratumId: id, pilot: z.boolean(), participantId: id }).strict()).max(60),
  declaredBy: id, declaredAt: z.string().datetime(),
}).passthrough();
export const DiscoveryPublicationResult = z.object({
  artifactId: id, versionId: id, versionNumber: version,
  materializedKeys: z.array(id).min(2), contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  evidenceGrade: z.literal("exploratory-provisional"),
}).passthrough();

export const DiscoveryArtifact = DiscoveryPublicationResult.extend({
  kind: z.literal("discovery_artifact"), title: id,
  frame: DiscoveryFrameBoundary, map: DiscoveryMapBoundary,
  digest: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();
