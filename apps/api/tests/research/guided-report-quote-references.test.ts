import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { extractReportEvidence } from "../../src/application/research/guided-report-evidence";
import { collectChunkEvidence } from "../../src/application/research/guided-report-evidence-validation";
const document = (text: string, url: string) => ({ text, url, contentHash: createHash("sha256").update(text).digest("hex"), contentKind: "text", truncated: false, retrievedAt: "now" });
const chunks = [
  { sourceId: "official", chunkId: "source:official/chunk:0", content: "Focus remains visible. Exceptions apply to equivalent controls." },
  { sourceId: "official", chunkId: "source:official/chunk:1", content: "Authentication allows password managers and pasting." },
];
const evaluation = (index: number, matches: unknown[]) => ({ sourceId: "official", chunkId: chunks[index]!.chunkId, irrelevant: false, matches });
const match = (quoteRef: string) => ({ questionId: "question", quoteRef, insight: "Official requirement supports the question.", relevance: "direct" });
const collect = (evaluations: unknown[]) => collectChunkEvidence(JSON.stringify({ evaluations }), chunks, new Set(["question"]), []);
describe("block-local source excerpt references", () => {
  it("materializes a selected source excerpt without trusting model-written quote text", () => {
    const result = collect([evaluation(0, [match("source:official/chunk:0#quote:0")]), evaluation(1, [match("source:official/chunk:1#quote:0")])]);
    expect(result.retryIds).toEqual([]);
    expect(result.valid.get(chunks[0]!.chunkId)?.[0]?.evidence.quote).toBe(chunks[0]!.content);
    expect(result.valid.get(chunks[1]!.chunkId)?.[0]?.evidence.quote).toBe(chunks[1]!.content);
  });
  it.each(["source:official/chunk:1#quote:0", "source:official/chunk:0#quote:999", "source:unknown/chunk:0#quote:0"])("rejects a foreign or unknown reference %s and preserves other valid blocks", (reference) => {
    const result = collect([evaluation(0, [match(reference)]), evaluation(1, [{ questionId: "question", quote: chunks[1]!.content, insight: "Supported.", relevance: "direct" }])]);
    expect(result.retryIds).toEqual([chunks[0]!.chunkId]);
    expect(result.valid.has(chunks[0]!.chunkId)).toBe(false);
    expect(result.valid.has(chunks[1]!.chunkId)).toBe(true);
  });
  it("rejects ambiguous reference plus literal quote atomically", () => {
    const result = collect([evaluation(0, [match("source:official/chunk:0#quote:0"), { ...match("source:official/chunk:0#quote:0"), quote: chunks[0]!.content }])]);
    expect(result.valid.has(chunks[0]!.chunkId)).toBe(false);
    expect(result.retryIds).toContain(chunks[0]!.chunkId);
  });
  it("still rejects rewritten literal quotes", () => {
    const result = collect([evaluation(0, [{ questionId: "question", quote: "Focus ... equivalent controls.", insight: "Supported.", relevance: "direct" }])]);
    expect(result.valid.has(chunks[0]!.chunkId)).toBe(false);
    expect(result.reasonCounts.non_verbatim_quote).toBe(1);
  });
});

it("supplies bounded block-local choices once and materializes selected quotes in extraction", async () => {
  const state = { tasks: [{ id: "task", sectionId: "chapter", query: "policy", status: "succeeded", attempts: 1, errorCode: null }], outline: [{ id: "chapter", enabled: true, questions: ["What is required?"] }], brief: {}, sources: [{ id: "official", taskId: "task", retrievedAt: "now", document: document("x".repeat(1201), "https://w3.org/policy"), title: "Policy", content: "x".repeat(1201), url: "https://w3.org/policy", decision: "accepted" }] } as any;
  const result = await extractReportEvidence(state, { provider: "fixture", id: "fixture" }, async (input, validate) => {
    const request = JSON.parse(input.user);
    const chunk = request.chunks[0];
    expect(chunk.content).toBeUndefined();
    expect(chunk.quoteOptions.map((choice: any) => choice.text).join("")).toBe(state.sources[0].content);
    expect(chunk.quoteOptions.every((choice: any) => choice.text.length <= 600)).toBe(true);
    return validate(JSON.stringify({ evaluations: [{ sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: false, matches: [{ ...match(chunk.quoteOptions[1].quoteRef), questionId: request.questions[0].id }] }] }));
  });
  expect([...result.matches.values()].flat()[0]?.quote).toBe("x".repeat(600));
});

it("retains valid blocks while retrying an invalid reference with stable block-local choices", async () => {
  const state = { tasks: [{ id: "task", sectionId: "chapter", query: "policy", status: "succeeded", attempts: 1, errorCode: null }], outline: [{ id: "chapter", enabled: true, questions: ["What is required?"] }], brief: {}, sources: chunks.map((chunk, index) => ({ id: `source${index}`, taskId: "task", retrievedAt: "now", document: document(chunk.content, `https://w3.org/policy/${index}`), title: "Policy", content: chunk.content, url: `https://w3.org/policy/${index}`, decision: "accepted" })) } as any;
  const requests: any[] = [];
  const result = await extractReportEvidence(state, { provider: "fixture", id: "fixture" }, async (input, validate) => {
    const request = JSON.parse(input.user); requests.push(request);
    return validate(JSON.stringify({ evaluations: request.chunks.map((chunk: any, index: number) => ({ sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: false, matches: [{ ...match(requests.length === 1 && index === 1 ? request.chunks[0].quoteOptions[0].quoteRef : chunk.quoteOptions[0].quoteRef), questionId: request.questions[0].id }] })) }));
  });
  expect(requests.map((request) => request.chunks.length)).toEqual([2, 1]);
  expect(requests[1].chunks[0].quoteOptions).toEqual(requests[0].chunks[1].quoteOptions);
  expect([...result.matches.values()].flat().map((item) => item.quote)).toEqual(chunks.map((chunk) => chunk.content));
});
it.each(["unknown_question", "unknown_field", "empty_insight"])("does not let a valid reference bypass %s validation", (fault) => {
  const candidate: any = match("source:official/chunk:0#quote:0");
  if (fault === "unknown_question") candidate.questionId = "unknown";
  if (fault === "unknown_field") candidate.extra = true;
  if (fault === "empty_insight") candidate.insight = "";
  const result = collect([evaluation(0, [candidate])]);
  expect(result.valid.has(chunks[0]!.chunkId)).toBe(false);
  expect(result.retryIds).toContain(chunks[0]!.chunkId);
});

it.each(["json", ""])("accepts one complete %s code fence through the existing research JSON codec", (language) => {
  const output = JSON.stringify({ evaluations: [evaluation(0, [match("source:official/chunk:0#quote:0")]), evaluation(1, [match("source:official/chunk:1#quote:0")])] });
  const result = collectChunkEvidence("```" + language + "\n" + output + "\n```", chunks, new Set(["question"]), []);
  expect(result.retryIds).toEqual([]);
  expect(result.valid.get(chunks[0]!.chunkId)?.[0]?.evidence.quote).toBe(chunks[0]!.content);
});
it.each(["preface", "trailing_prose", "truncated", "multiple_blocks"])("rejects %s without salvaging arbitrary JSON substrings", (fault) => {
  const output = JSON.stringify({ evaluations: [evaluation(0, [match("source:official/chunk:0#quote:0")])] });
  const fenced = "```json\n" + output + "\n```";
  const text = fault === "preface" ? "Here is evidence:\n" + fenced : fault === "trailing_prose" ? fenced + "\nExtra explanation" : fault === "truncated" ? "```json\n" + output.slice(0, -5) + "\n```" : fenced + "\n" + fenced;
  const result = collectChunkEvidence(text, chunks, new Set(["question"]), []);
  expect(result.wholeBatch).toBe(true);
  expect(result.valid.size).toBe(0);
  expect(result.reasonCounts.invalid_json).toBe(1);
});
it("still rejects foreign quote references inside a valid code fence", () => {
  const text = "```json\n" + JSON.stringify({ evaluations: [evaluation(0, [match("source:official/chunk:1#quote:0")])] }) + "\n```";
  const result = collectChunkEvidence(text, chunks, new Set(["question"]), []);
  expect(result.valid.has(chunks[0]!.chunkId)).toBe(false);
  expect(result.retryIds).toContain(chunks[0]!.chunkId);
});
