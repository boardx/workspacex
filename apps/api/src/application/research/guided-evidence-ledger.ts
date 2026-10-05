import { createHash } from "node:crypto";
import { sourceAllowedByPolicy } from "./guided-source-policy";
import { GUIDED_EVIDENCE_VALIDATOR_VERSION, GuidedEvidenceLedger, GuidedEvidenceLedgerRecord } from "./guided-evidence-ledger-record";
import type { ResearchRuntime } from "./guided-runtime-ports";
import type { EvidenceQuestion, VerifiedEvidence } from "./guided-report-evidence";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const sorted = (values: readonly string[]) => [...new Set(values)].sort();
function confirmed(state: ResearchRuntime, question: EvidenceQuestion) {
  const section = state.outline.find(section => section.enabled && section.id === question.sectionId);
  return section && [...section.questions, ...(section.subsections ?? []).flatMap(subsection => subsection.questions)].includes(question.question) ? section : undefined;
}
/** Full confirmation inputs for this question, independent of legacy wire indices,
 * execution version, source additions, and ordering. Materials are checked per record. */
export function ledgerBasis(state: ResearchRuntime, question: EvidenceQuestion): string {
  const section = confirmed(state, question);
  return hash(JSON.stringify({ validatorVersion: GUIDED_EVIDENCE_VALIDATOR_VERSION,
    brief: state.brief, intent: state.intent ?? null, sourcePolicy: state.sourcePolicy ?? null,
    section: section ? { id: section.id, title: section.title, objective: section.objective ?? null, analysisApproach: section.analysisApproach ?? null, expectedOutput: section.expectedOutput ?? null, questions: sorted(section.questions),
      subsections: [...(section.subsections ?? [])].sort((a, b) => a.id.localeCompare(b.id)).map(subsection => ({ id: subsection.id, title: subsection.title, questions: sorted(subsection.questions) })) } : null,
    questionTextHash: hash(question.question),
    tasks: state.tasks.filter(task => task.sectionId === question.sectionId).map(({ id, sectionId, query, title, objective, deliverables }) => ({ id, sectionId, query, title, objective, deliverables })).sort((a, b) => a.id.localeCompare(b.id)),
  }));
}
export function ledgerQuestionKey(question: EvidenceQuestion, basis: string) {
  return hash(JSON.stringify([question.sectionId, hash(question.question), basis]));
}
function material(state: ResearchRuntime, sourceId: string) {
  const source = state.sources.find(source => source.id === sourceId);
  if (!source || source.decision !== "accepted" || !sourceAllowedByPolicy(source, state.sourcePolicy) || !source.document) return;
  const documentHash = hash(source.document.text);
  if (documentHash !== source.document.contentHash) return;
  let sourceUrl: string, documentUrl: string;
  try { sourceUrl = new URL(source.url).href; documentUrl = new URL(source.document.url).href; } catch { return; }
  return { source, text: source.document.text, documentHash, sourceUrl, documentUrl, sourceRetrievedAt: source.retrievedAt, documentRetrievedAt: source.document.retrievedAt };
}
/** Only call after the existing collectChunkEvidence validator accepted this
 * exact source/chunk/question. Deterministic revalidation adds provenance, not a
 * second semantic model judgement or confidence score. */
export function recordVerifiedEvidence(state: ResearchRuntime, question: EvidenceQuestion, evidence: VerifiedEvidence,
  chunk: { chunkId: string; start: number; content: string }, verifiedAt = new Date().toISOString()): GuidedEvidenceLedgerRecord | undefined {
  const original = material(state, evidence.sourceId);
  if (!original || !confirmed(state, question) || original.text.slice(chunk.start, chunk.start + chunk.content.length) !== chunk.content) return;
  const localStart = chunk.content.indexOf(evidence.quote);
  if (localStart < 0) return;
  const basis = ledgerBasis(state, question), questionKey = ledgerQuestionKey(question, basis), quoteStart = chunk.start + localStart;
  const taskId = original.source.taskId;
  if (!state.tasks.some(task => task.id === taskId)) return;
  const fact = { questionKey, sectionId: question.sectionId, questionTextHash: hash(question.question), basis, taskId, sourceId: evidence.sourceId,
    sourceUrl: original.sourceUrl, documentUrl: original.documentUrl, sourceRetrievedAt: original.sourceRetrievedAt, documentRetrievedAt: original.documentRetrievedAt,
    documentHash: original.documentHash, materialKind: "fetched_document" as const, chunkId: chunk.chunkId, chunkStart: chunk.start,
    quoteStart, quoteEnd: quoteStart + evidence.quote.length, quote: evidence.quote, quoteHash: hash(evidence.quote), insight: evidence.insight,
    relevance: evidence.relevance, verifiedAt, validatorVersion: GUIDED_EVIDENCE_VALIDATOR_VERSION };
  return GuidedEvidenceLedgerRecord.parse({ ...fact, evidenceId: `evidence:${hash(JSON.stringify([questionKey, taskId, fact.sourceId, fact.documentHash, fact.sourceUrl, fact.documentUrl, fact.sourceRetrievedAt, fact.documentRetrievedAt, fact.chunkId, quoteStart, fact.quoteHash, fact.relevance]))}` });
}
function valid(state: ResearchRuntime, question: EvidenceQuestion, record: GuidedEvidenceLedgerRecord) {
  if (!GuidedEvidenceLedgerRecord.safeParse(record).success || !confirmed(state, question)) return false;
  const original = material(state, record.sourceId);
  const basis = ledgerBasis(state, question);
  if (!original || record.basis !== basis || record.questionKey !== ledgerQuestionKey(question, basis) || record.sectionId !== question.sectionId || record.questionTextHash !== hash(question.question)) return false;
  if (record.sourceUrl !== original.sourceUrl || record.documentUrl !== original.documentUrl || record.sourceRetrievedAt !== original.sourceRetrievedAt || record.documentRetrievedAt !== original.documentRetrievedAt) return false;
  if (record.documentHash !== original.documentHash || ![original.source.taskId, ...(original.source.taskIds ?? [])].includes(record.taskId)) return false;
  if (record.chunkStart % 6000 || record.chunkId !== `source:${record.sourceId}/chunk:${record.chunkStart / 6000}` || record.quoteEnd > Math.min(original.text.length, record.chunkStart + 6000)) return false;
  if (original.text.slice(record.quoteStart, record.quoteEnd) !== record.quote || record.quoteHash !== hash(record.quote)) return false;
  const expected = recordVerifiedEvidence(state, question, record, { chunkId: record.chunkId, start: record.chunkStart, content: original.text.slice(record.chunkStart, record.chunkStart + 6000) }, record.verifiedAt);
  return expected?.evidenceId === record.evidenceId && expected.quoteStart === record.quoteStart;
}
export function readQuestionLedger(state: ResearchRuntime, question: EvidenceQuestion): GuidedEvidenceLedgerRecord[] {
  const parsed = GuidedEvidenceLedger.safeParse(state.privateLedger);
  return parsed.success ? parsed.data.records.filter(record => valid(state, question, record)) : [];
}
/** Drop invalid facts rather than relabelling old records as newly verified. */
export function reconcileEvidenceLedger(state: ResearchRuntime): GuidedEvidenceLedger {
  const questions: EvidenceQuestion[] = state.outline.filter(section => section.enabled).flatMap(section => sorted([...section.questions, ...(section.subsections ?? []).flatMap(subsection => subsection.questions)]).map(question => ({ id: "", sectionId: section.id, question })));
  return GuidedEvidenceLedger.parse({ validatorVersion: GUIDED_EVIDENCE_VALIDATOR_VERSION, records: questions.flatMap(question => readQuestionLedger(state, question)).filter((record, index, records) => records.findIndex(item => item.evidenceId === record.evidenceId) === index) });
}
