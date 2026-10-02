import { materializeQuoteReferences } from "./guided-report-quote-references";
import { research as C } from "@repo/contracts";
import type { VerifiedEvidence } from "./guided-report-evidence";
export interface EvidenceChunk { sourceId: string; chunkId: string; content: string }
export interface EvidenceCandidate { questionId: string; evidence: VerifiedEvidence }
export type EvidenceFailureReason = "invalid_json" | "invalid_envelope" | "oversized_response" | "invalid_evaluation" | "unknown_source_or_chunk" | "duplicate_chunk" | "missing_chunk" | "inconsistent_irrelevance" | "unknown_question" | "non_verbatim_quote";
export interface EvidenceAttemptDiagnostic {
  batchIndex: number; attempt: number; suppliedChunks: number; validChunks: number; retryChunks: number;
  durationMs: number; failed: boolean; reasonCounts: Partial<Record<EvidenceFailureReason | "audit_error", number>>;
}
export function collectChunkEvidence(text: string, chunks: readonly EvidenceChunk[], questionIds: ReadonlySet<string>, aliases: readonly { alias: string; sourceId: string }[]) {
  const valid = new Map<string, EvidenceCandidate[]>(); const seen = new Set<string>(); const rejected = new Set<string>();
  const reasonCounts: Partial<Record<EvidenceFailureReason, number>> = {};
  const fail = (reason: EvidenceFailureReason) => { reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1; };
  const whole = (reason: EvidenceFailureReason) => { fail(reason); return { valid, retryIds: chunks.map((chunk) => chunk.chunkId), wholeBatch: true, reasonCounts, repairOutput: text.slice(0, 100000) }; };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return whole("invalid_json"); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return whole("invalid_envelope");
  const { evaluations, ...envelope } = raw as Record<string, unknown>;
  if (!Array.isArray(evaluations) || !C.GuidedResearchEvidenceModelOutput.omit({ evaluations: true }).safeParse(envelope).success) return whole("invalid_envelope");
  // Use the authoritative array schema to check its bounds without private Zod fields.
  if (evaluations.length && !C.GuidedResearchEvidenceModelOutput.shape.evaluations.safeParse(evaluations.map(() => ({ sourceId: chunks[0]!.sourceId, chunkId: chunks[0]!.chunkId, irrelevant: true, matches: [] }))).success) return whole("oversized_response");
  let wholeBatch = false;
  const rejectedValues: unknown[] = [];
  for (const value of evaluations) {
    const identity = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const isolateClaimedChunk = () => { const claimed = chunks.find((chunk) => chunk.chunkId === identity.chunkId); if (claimed) { rejected.add(claimed.chunkId); valid.delete(claimed.chunkId); } };
    if (typeof identity.sourceId !== "string" || typeof identity.chunkId !== "string") { fail("invalid_evaluation"); isolateClaimedChunk(); wholeBatch = true; continue; }
    const sourceId = chunks.some((chunk) => chunk.sourceId === identity.sourceId) ? identity.sourceId : aliases.find((alias) => alias.alias === identity.sourceId)?.sourceId;
    const chunk = chunks.find((item) => item.chunkId === identity.chunkId && item.sourceId === sourceId);
    if (!chunk) { fail("unknown_source_or_chunk"); isolateClaimedChunk(); wholeBatch = true; continue; }
    if (seen.has(chunk.chunkId)) { fail("duplicate_chunk"); rejected.add(chunk.chunkId); valid.delete(chunk.chunkId); rejectedValues.push(value); continue; }
    seen.add(chunk.chunkId);
    const parsed = C.GuidedResearchEvidenceModelOutput.shape.evaluations.element.safeParse(materializeQuoteReferences(identity, chunk));
    if (!parsed.success) { fail("invalid_evaluation"); rejected.add(chunk.chunkId); rejectedValues.push(value); continue; }
    if (parsed.data.irrelevant !== (parsed.data.matches.length === 0)) { fail("inconsistent_irrelevance"); rejected.add(chunk.chunkId); rejectedValues.push(value); continue; }
    const candidates: EvidenceCandidate[] = [];
    for (const match of parsed.data.matches) {
      if (!questionIds.has(match.questionId)) { fail("unknown_question"); rejected.add(chunk.chunkId); continue; }
      if (!chunk.content.includes(match.quote)) { fail("non_verbatim_quote"); rejected.add(chunk.chunkId); continue; }
      candidates.push({ questionId: match.questionId, evidence: { sourceId: chunk.sourceId, quote: match.quote, insight: match.insight, relevance: match.relevance } });
    }
    if (rejected.has(chunk.chunkId)) rejectedValues.push(value);
    else valid.set(chunk.chunkId, candidates);
  }
  for (const chunk of chunks) if (!seen.has(chunk.chunkId)) { fail("missing_chunk"); rejected.add(chunk.chunkId); }
  const retryIds = chunks.filter((chunk) => wholeBatch || rejected.has(chunk.chunkId)).map((chunk) => chunk.chunkId);
  return { valid, retryIds, wholeBatch, reasonCounts, repairOutput: wholeBatch ? text.slice(0, 100000) : JSON.stringify({ evaluations: rejectedValues }).slice(0, 100000) };
}
