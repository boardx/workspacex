import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { extractReportEvidence, reportQuestions, selectQuestionEvidence } from "../../src/application/research/guided-report-evidence";
import { ledgerBasis, ledgerQuestionKey, readQuestionLedger, reconcileEvidenceLedger } from "../../src/application/research/guided-evidence-ledger";
import type { ResearchRuntime } from "../../src/application/research/guided-runtime-ports";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function state(): ResearchRuntime {
  const text = " ".repeat(6000) + "Exact original evidence supports this comparison.";
  return { sessionId: "ledger", version: 2, revision: 1, currentNode: "report", availableNodes: ["report"], brief: { topic: "Policy", goal: "Compare", region: "EU", focus: "Grid", timeRange: "2026" }, directions: [],
    outline: [{ id: "a", title: "A", order: 0, enabled: true, questions: ["What is established?", "What remains unknown?"] }, { id: "b", title: "B", order: 1, enabled: true, questions: ["What is established?"] }],
    tasks: [{ id: "task-a", sectionId: "a", query: "policy", status: "succeeded", attempts: 1, errorCode: null }],
    sources: [{ id: "source", taskId: "task-a", title: "Original", url: "https://example.org/original", content: "Discovery excerpt", decision: "accepted", retrievedAt: "now", document: { url: "https://example.org/original", text, contentHash: hash(text), contentKind: "text", truncated: false, retrievedAt: "now" } }], report: null, busy: false, completed: false, leaseUntil: null, errorCode: null, generatedNodes: [], modelCalls: [], messages: [], proposal: null };
}
const config = { provider: "controlled", id: "mock" };
async function extract(current: ResearchRuntime, relevance: "direct" | "context" = "direct") {
  return extractReportEvidence(current, config, async (input, validate) => {
    const context = JSON.parse(input.user);
    return validate(JSON.stringify({ evaluations: context.chunks.map((chunk: any) => ({ sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: !chunk.quoteOptions.length,
      matches: chunk.quoteOptions.length ? [{ questionId: context.questions.find((q: any) => q.sectionId === "a").id, quoteRef: chunk.quoteOptions[0].quoteRef, insight: "Literal quote support", relevance }] : [] })) }));
  });
}
it("records only decoder-validated exact original spans and leaves unmatched questions as gaps", async () => {
  const current = state(), result = await extract(current), q = reportQuestions(current.outline)[0]!;
  const entries = readQuestionLedger(current, q);
  expect(entries).toHaveLength(1); const record = entries[0]!;
  expect(record).toMatchObject({ taskId: "task-a", sourceId: "source", materialKind: "fetched_document", chunkStart: 6000, quoteStart: 6000, relevance: "direct" });
  expect(record.quoteEnd).toBe(6000 + "Exact original evidence supports this comparison.".length); expect(record.documentHash).toBe(hash(current.sources[0]!.document!.text));
  expect(record.quoteHash).toBe(hash(record.quote)); expect(record.questionKey).toBe(ledgerQuestionKey(q, ledgerBasis(current, q)));
  expect(current.sources[0]!.document!.text.slice(record.quoteStart, record.quoteEnd)).toBe(record.quote);
  expect(selectQuestionEvidence(result, current.outline[0]!)[1]!.gap).toBe(true);
});
it("keeps the same question identity on reorder and cannot borrow equal wording from another section", async () => {
  const current = state(); await extract(current); const initialQuestion = reportQuestions(current.outline)[0]!, basis = ledgerBasis(current, initialQuestion), old = readQuestionLedger(current, reportQuestions(current.outline)[0]!)[0]!;
  current.outline.reverse(); current.outline[0]!.order = 0; current.outline[1]!.order = 1; current.outline[1]!.questions.reverse();
  expect(ledgerBasis(current, initialQuestion)).toBe(basis);
  const questions = reportQuestions(current.outline), q = questions.find(q => q.sectionId === "a" && q.question === "What is established?")!;
  expect(readQuestionLedger(current, q)[0]?.evidenceId).toBe(old.evidenceId);
  expect(readQuestionLedger(current, questions.find(q => q.sectionId === "b")!)).toEqual([]);
});
it.each(["question", "body", "exclude", "policy", "span", "quote", "validator"])("rejects stale or tampered %s ledger facts without promoting them", async change => {
  const current = state(); await extract(current); const q = reportQuestions(current.outline)[0]!;
  if (change === "question") current.outline[0]!.questions[0] = "A changed question";
  if (change === "body") current.sources[0]!.document!.text += " Changed material";
  if (change === "exclude") current.sources[0]!.decision = "excluded";
  if (change === "policy") current.sourcePolicy = { mode: "restrict", domains: ["other.example.org"], internalSourceIds: [], revision: 1 };
  const record = current.privateLedger!.records[0]!;
  if (change === "span") record.quoteStart++;
  if (change === "quote") record.quote = "Fabricated quote";
  if (change === "validator") (record as any).validatorVersion = 99;
  expect(readQuestionLedger(current, q)).toEqual([]); expect(reconcileEvidenceLedger(current).records).toEqual([]);
});
it("retains context-only relevance and never labels legacy sources as verified without extraction", async () => {
  const current = state(), q = reportQuestions(current.outline)[0]!;
  expect(readQuestionLedger(current, q)).toEqual([]);
  const result = await extract(current, "context");
  expect(readQuestionLedger(current, q)[0]?.relevance).toBe("context");
  expect(selectQuestionEvidence(result, current.outline[0]!)[0]!.gap).toBe(true);
});
it("does not create ledger records from all-invalid model output", async () => {
  const current = state(), audit = vi.fn(async (_input, validate) => validate('{"evaluations":[]}'));
  await expect(extractReportEvidence(current, config, audit)).rejects.toThrow("RESEARCH_CONTENT_REFERENCE_INVALID");
  expect(current.privateLedger?.records ?? []).toEqual([]);
});

it("never promotes search excerpts or a mismatched document hash into verified records", async () => {
  for (const missing of [true, false]) {
    const current = state();
    if (missing) delete current.sources[0]!.document;
    else current.sources[0]!.document!.contentHash = "0".repeat(64);
    await extract(current);
    expect(current.privateLedger?.records).toEqual([]);
    expect(readQuestionLedger(current, reportQuestions(current.outline)[0]!)).toEqual([]);
  }
});
it("does not invalidate existing facts solely because another source was added", async () => {
  const current = state(); await extract(current); const q = reportQuestions(current.outline)[0]!, record = readQuestionLedger(current, q)[0]!;
  current.sources.push({ ...current.sources[0]!, id: "new", url: "https://example.org/new" });
  expect(readQuestionLedger(current, q)[0]?.evidenceId).toBe(record.evidenceId);
});
it("keeps one validated original span for repeated text across chunks without borrowing another source", async () => {
  const current = state(); current.sources[0]!.document!.text = Array.from({ length: 10 }, () => "Exact original evidence supports this comparison.".padEnd(6000, " ")).join("");
  current.sources[0]!.document!.contentHash = hash(current.sources[0]!.document!.text);
  await extract(current); const q = reportQuestions(current.outline)[0]!;
  const records = readQuestionLedger(current, q); expect(records).toHaveLength(1);
  expect(records[0]!.quoteStart).toBe(0);
  current.privateLedger!.records[0]!.chunkId = "source:other/chunk:0";
  expect(readQuestionLedger(current, q)).toEqual([]);
});

it("rejects an unknown ledger envelope and does not restamp surviving facts on execution changes", async () => {
  const current = state(); await extract(current); const q = reportQuestions(current.outline)[0]!;
  const old = readQuestionLedger(current, q)[0]!;
  current.version++; current.revision++; current.busy = true;
  expect(reconcileEvidenceLedger(current).records[0]).toEqual(old);
  (current.privateLedger as any).validatorVersion = 99;
  expect(readQuestionLedger(current, q)).toEqual([]);
  expect(reconcileEvidenceLedger(current).records).toEqual([]);
});
it("preserves independently verified questions outside a partial section extraction", async () => {
  const current = state();
  const audit = async (input: any, validate: any) => {
    const c = JSON.parse(input.user);
    return validate(JSON.stringify({ evaluations: c.chunks.map((chunk: any) => ({ sourceId: chunk.sourceId, chunkId: chunk.chunkId,
      irrelevant: !chunk.quoteOptions.length, matches: chunk.quoteOptions.length ? c.questions.map((q: any) => ({ questionId: q.id,
        quoteRef: chunk.quoteOptions[0].quoteRef, insight: "Literal quote support", relevance: "direct" })) : [] })) }));
  };
  await extractReportEvidence(current, config, audit);
  const b = reportQuestions(current.outline).find(q => q.sectionId === "b")!;
  const before = readQuestionLedger(current, b);
  expect(before).toHaveLength(1);
  await extractReportEvidence(current, config, audit, new Set(["a"]));
  expect(readQuestionLedger(current, b)).toEqual(before);
});

it.each(["sourceUrl", "documentUrl", "sourceRetrievedAt", "documentRetrievedAt", "objective", "analysisApproach", "expectedOutput"])("invalidates changed provenance or confirmation %s", async change => {
  const current = state(); await extract(current); const q = reportQuestions(current.outline)[0]!;
  if (change === "sourceUrl") current.sources[0]!.url = "https://other.example.org/original";
  if (change === "documentUrl") current.sources[0]!.document!.url = "https://other.example.org/document";
  if (change === "sourceRetrievedAt") current.sources[0]!.retrievedAt = "later-source-fetch";
  if (change === "documentRetrievedAt") current.sources[0]!.document!.retrievedAt = "later-document-fetch";
  if (change === "objective") current.outline[0]!.objective = "Another decision objective";
  if (change === "analysisApproach") current.outline[0]!.analysisApproach = "Different comparative approach";
  if (change === "expectedOutput") current.outline[0]!.expectedOutput = "Another expected output";
  expect(readQuestionLedger(current, q)).toEqual([]);
  expect(reconcileEvidenceLedger(current).records).toEqual([]);
});
