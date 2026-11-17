import { z } from "zod";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
/** QA owner evidence, not a product endpoint or a replacement for normal API authorization. */
const Preflight = z.object({ schemaVersion: z.literal(1), kind: z.literal("aidt-s2-supplement-readonly-preflight"), observedAt: z.string().datetime(),
  orgId: z.string().min(1), userId: z.string().min(1), projectId: z.string().min(1), oldRunId: z.string().min(1), oldRunStatus: z.literal("cancelled"),
  agentId: z.string().min(1), oldAgentVersionId: z.string().min(1), publishedAgentVersionId: z.string().min(1), instructionsSha256: sha,
  apiOwner: z.object({ pid: z.number().int().positive(), startTicks: z.string().regex(/^\d+$/) }).strict(),
  nativeExecutorEnabled: z.literal(true), allowedTask: z.literal("additional-s2-once"), activeRuns: z.literal(0), holdsHundredths: z.literal(0), unsettledRequests: z.literal(0),
}).strict();
const ReviewedFixture = z.object({ schemaVersion: z.literal(1), kind: z.literal("private-isolated-QA-fixture-append-only"), applied: z.literal(true),
  orgId: z.string(), agentId: z.string(), oldVersionId: z.string(), newVersionId: z.string(), newInstructionDigest: sha,
}).passthrough();

export function validateS2SupplementPreflight(raw: unknown, reviewed: unknown, scope: {
  orgId: string; userId: string; projectId: string; oldRunId: string; agentId: string; oldAgentVersionId: string;
}, now = Date.now()) {
  const proof = Preflight.parse(raw), fixture = ReviewedFixture.parse(reviewed);
  if (now - Date.parse(proof.observedAt) > 300_000 || Date.parse(proof.observedAt) > now + 5_000) throw new Error("AIDT_S2_SUPPLEMENT_PREFLIGHT_STALE");
  for (const key of ["orgId", "userId", "projectId", "oldRunId", "agentId", "oldAgentVersionId"] as const) {
    if (proof[key] !== scope[key]) throw new Error("AIDT_S2_SUPPLEMENT_PREFLIGHT_SCOPE_MISMATCH");
  }
  if (fixture.orgId !== scope.orgId || fixture.agentId !== scope.agentId || fixture.oldVersionId !== scope.oldAgentVersionId
    || proof.publishedAgentVersionId !== fixture.newVersionId || proof.instructionsSha256 !== fixture.newInstructionDigest
    || proof.publishedAgentVersionId === proof.oldAgentVersionId) throw new Error("AIDT_S2_SUPPLEMENT_CANONICAL_VERSION_MISMATCH");
  return proof;
}

/** This one empty thread survived the first, independently audited zero-send QA failure. */
export function validateS2EmptyThreadReuse(raw: unknown, expected: {
  orgId: string; projectId: string; oldThreadId: string; skillId: string; skillVersionId: string;
  legacyHash: string; s1Hash: string;
}) {
  const proof = z.object({
    at: z.string().datetime(), readOnly: z.literal(true), originalThreadsRetained: z.literal(true),
    newThread: z.object({ id: z.string().min(1), org_id: z.string(), project_id: z.string() }),
    messages: z.literal(0), runs: z.literal(0),
    mounts: z.array(z.object({ skill_id: z.string(), version_id: z.string(), stable_name: z.literal("aidt-empathize") })).length(1),
    finance: z.object({ total_runs: z.literal(2), active: z.literal(0), physical: z.literal(2), usage: z.literal(2), credit: z.literal(2),
      unsettled: z.literal(0), holds: z.literal("0"), unbounded: z.literal("0") }),
    oldBudgetHashes: z.object({ legacy: sha, supplementS1: sha }), oldBudgetsUnchanged: z.literal(true),
    supplementalS2LedgerAbsent: z.literal(true), modelRequestsSentByAudit: z.literal(0),
  }).parse(raw);
  if (proof.newThread.org_id !== expected.orgId || proof.newThread.project_id !== expected.projectId || proof.newThread.id === expected.oldThreadId
    || proof.mounts[0]!.skill_id !== expected.skillId || proof.mounts[0]!.version_id !== expected.skillVersionId
    || proof.oldBudgetHashes.legacy !== expected.legacyHash || proof.oldBudgetHashes.supplementS1 !== expected.s1Hash) {
    throw new Error("AIDT_S2_EMPTY_THREAD_REUSE_MISMATCH");
  }
  return proof;
}
