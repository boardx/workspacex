import { GUIDED_REPORT_EVIDENCE_CACHE_LIMIT } from "./guided-runtime-persistence";
import { createHash } from "node:crypto";
import { ledgerBasis, ledgerQuestionKey, reconcileEvidenceLedger, recordVerifiedEvidence } from "./guided-evidence-ledger";
import { GUIDED_EVIDENCE_MATCH_LIMIT, GUIDED_EVIDENCE_VALIDATOR_VERSION, type GuidedEvidenceLedgerRecord } from "./guided-evidence-ledger-record";
import type { EvidenceCandidate } from "./guided-report-evidence-validation";
import type { EvidenceQuestion } from "./guided-report-evidence";
import type { ResearchRuntime } from "./guided-runtime-ports";
type Candidate = EvidenceCandidate & { chunkId: string; chunkStart: number };
type Chunk = { sourceId: string; chunkId: string; start: number; content: string };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Complete validated batch coverage is separate from positive facts. Negative
 * results are reusable only with the exact materials/questions/configuration.
 */
export function evidenceBatchBasis(state: ResearchRuntime, questions: EvidenceQuestion[], chunks: Chunk[], input: unknown, configurationIdentity?: string) {
  if (!configurationIdentity) return;
  const materials = chunks.map(chunk => state.sources.find(source => source.id === chunk.sourceId));
  if (materials.some(source => !source?.document || source.document.contentHash !== hash(source.document.text)
    || !state.tasks.some(task => task.id === source.taskId))) return;
  return hash(JSON.stringify({ version: GUIDED_EVIDENCE_VALIDATOR_VERSION, input, configurationIdentity,
    policy: "thinking_off_v1", questions: questions.map(question => ledgerQuestionKey(question, ledgerBasis(state, question))),
    materials: materials.map(source => ({ id: source!.id, taskId: source!.taskId, url: source!.url, retrievedAt: source!.retrievedAt, document: {
      url: source!.document!.url, contentHash: source!.document!.contentHash, retrievedAt: source!.document!.retrievedAt,
      truncated: source!.document!.truncated, contentKind: source!.document!.contentKind,
    } })),
  }));
}
export function readEvidenceBatch(state: ResearchRuntime, basis: string | undefined, questions: EvidenceQuestion[], validatedRecords = reconcileEvidenceLedger(state).records): Candidate[] | undefined {
  if (!basis) return;
  const completed = state.privateReportEvidenceBatches?.find(batch => batch.basis === basis);
  if (!completed) return;
  const records = new Map(validatedRecords.map(record => [record.evidenceId, record]));
  const identities = new Map(questions.map(question => [ledgerQuestionKey(question, ledgerBasis(state, question)), question]));
  const candidates: Candidate[] = [];
  for (const id of completed.evidenceIds) {
    const record = records.get(id);
    const question = record && identities.get(record.questionKey);
    if (!record || !question) return;
    candidates.push({ questionId: question.id, chunkId: record.chunkId, chunkStart: record.chunkStart, quoteOffset: record.quoteStart - record.chunkStart,
      evidence: { sourceId: record.sourceId, quote: record.quote, insight: record.insight, relevance: record.relevance } });
  }
  return candidates;
}
export function rememberEvidenceBatch(state: ResearchRuntime, basis: string | undefined, candidates: Candidate[], questions: EvidenceQuestion[], chunks: Chunk[]) {
  if (!basis) return;
  const verified = candidates.map(candidate => {
    const question = questions.find(question => question.id === candidate.questionId);
    const chunk = chunks.find(chunk => chunk.chunkId === candidate.chunkId);
    return question && chunk ? recordVerifiedEvidence(state, question, candidate.evidence, { ...chunk, quoteOffset: candidate.quoteOffset }) : undefined;
  });
  if (verified.some(record => !record)) return;
  // Existing facts are revalidated once at extraction entry and before final merge.
  // Appending a newly validated batch must not re-hash all earlier documents.
  const records = new Map<string, GuidedEvidenceLedgerRecord>((state.privateLedger?.records ?? []).map(record => [record.evidenceId, record]));
  for (const record of verified) records.set(record!.evidenceId, record!);
  if (records.size > GUIDED_EVIDENCE_MATCH_LIMIT) return;
  state.privateLedger = { validatorVersion: GUIDED_EVIDENCE_VALIDATOR_VERSION, records: [...records.values()] };
  state.privateReportEvidenceBatches = [...(state.privateReportEvidenceBatches ?? []).filter(batch => batch.basis !== basis),
    { basis, evidenceIds: verified.map(record => record!.evidenceId) }].slice(-GUIDED_REPORT_EVIDENCE_CACHE_LIMIT);
}
