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
