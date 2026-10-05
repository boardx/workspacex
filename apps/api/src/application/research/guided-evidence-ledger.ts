import { createHash } from "node:crypto";
import { sourceAllowedByPolicy } from "./guided-source-policy";
import { GUIDED_EVIDENCE_CHUNK_SIZE, GUIDED_EVIDENCE_VALIDATOR_VERSION, GuidedEvidenceLedger, GuidedEvidenceLedgerRecord } from "./guided-evidence-ledger-record";
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
function evidenceId(fact: Pick<GuidedEvidenceLedgerRecord, "questionKey" | "taskId" | "sourceId" | "documentHash" | "sourceUrl" | "documentUrl" | "sourceRetrievedAt" | "documentRetrievedAt" | "chunkId" | "quoteStart" | "quoteHash" | "relevance">) {
  return `evidence:${hash(JSON.stringify([fact.questionKey, fact.taskId, fact.sourceId, fact.documentHash, fact.sourceUrl, fact.documentUrl, fact.sourceRetrievedAt, fact.documentRetrievedAt, fact.chunkId, fact.quoteStart, fact.quoteHash, fact.relevance]))}`;
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
  return GuidedEvidenceLedgerRecord.parse({ ...fact, evidenceId: evidenceId(fact) });
}
/** One immutable validation pass: envelope once, question identity once, and
 * original material once per source. Caches never survive a call/state change. */
function ledgerReader(state: ResearchRuntime) {
  const parsed = GuidedEvidenceLedger.safeParse(state.privateLedger);
  const buckets = new Map<string, GuidedEvidenceLedgerRecord[]>();
  const bucketKey = (sectionId: string, questionTextHash: string, questionKey: string) => JSON.stringify([sectionId, questionTextHash, questionKey]);
  if (parsed.success) for (const record of parsed.data.records) {
    const key = bucketKey(record.sectionId, record.questionTextHash, record.questionKey);
    const bucket = buckets.get(key) ?? []; bucket.push(record); buckets.set(key, bucket);
  }
  const materials = new Map<string, ReturnType<typeof material>>();
  const taskIds = new Set(state.tasks.map(task => task.id));
  const identities = new Map<string, { basis: string; key: string; textHash: string }>();
  return (question: EvidenceQuestion) => {
    if (!confirmed(state, question)) return [];
    const identityKey = JSON.stringify([question.sectionId, question.question]);
    let identity = identities.get(identityKey);
    if (!identity) {
      const basis = ledgerBasis(state, question), textHash = hash(question.question);
      identity = { basis, textHash, key: hash(JSON.stringify([question.sectionId, textHash, basis])) };
      identities.set(identityKey, identity);
    }
    return (buckets.get(bucketKey(question.sectionId, identity.textHash, identity.key)) ?? []).filter(record => {
      // Reject unrelated/stale identities before hashing any document body.
      if (record.basis !== identity!.basis) return false;
      if (!materials.has(record.sourceId)) materials.set(record.sourceId, material(state, record.sourceId));
      const original = materials.get(record.sourceId);
      if (!original || record.sourceUrl !== original.sourceUrl || record.documentUrl !== original.documentUrl || record.sourceRetrievedAt !== original.sourceRetrievedAt || record.documentRetrievedAt !== original.documentRetrievedAt) return false;
      if (record.documentHash !== original.documentHash || record.taskId !== original.source.taskId || !taskIds.has(record.taskId)) return false;
      if (record.chunkStart % GUIDED_EVIDENCE_CHUNK_SIZE || record.chunkId !== `source:${record.sourceId}/chunk:${record.chunkStart / GUIDED_EVIDENCE_CHUNK_SIZE}` || record.quoteEnd > Math.min(original.text.length, record.chunkStart + GUIDED_EVIDENCE_CHUNK_SIZE)) return false;
      if (original.text.slice(record.quoteStart, record.quoteEnd) !== record.quote || record.quoteHash !== hash(record.quote)) return false;
      const chunk = original.text.slice(record.chunkStart, record.chunkStart + GUIDED_EVIDENCE_CHUNK_SIZE);
      // Preserve the creator's deterministic first exact occurrence within the
      // proven chunk, without calling its full material/basis validation again.
      if (chunk.indexOf(record.quote) !== record.quoteStart - record.chunkStart) return false;
      return evidenceId(record) === record.evidenceId;
    });
  };
}
export function readQuestionLedger(state: ResearchRuntime, question: EvidenceQuestion): GuidedEvidenceLedgerRecord[] {
  return ledgerReader(state)(question);
}
/** Drop invalid facts rather than relabelling old records as newly verified. */
export function reconcileEvidenceLedger(state: ResearchRuntime): GuidedEvidenceLedger {
  const read = ledgerReader(state), seen = new Set<string>();
  const questions: EvidenceQuestion[] = state.outline.filter(section => section.enabled).flatMap(section => sorted([...section.questions, ...(section.subsections ?? []).flatMap(subsection => subsection.questions)]).map(question => ({ id: "", sectionId: section.id, question })));
  const records = questions.flatMap(read).filter(record => {
    if (seen.has(record.evidenceId)) return false;
    seen.add(record.evidenceId); return true;
  });
  // Every returned record already passed the single authoritative schema parse.
  return { validatorVersion: GUIDED_EVIDENCE_VALIDATOR_VERSION, records };
}
