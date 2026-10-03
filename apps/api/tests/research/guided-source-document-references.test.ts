import { describe, expect, it, vi } from "vitest";
import { research as C } from "@repo/contracts";
import { initialRuntime } from "../../src/application/research/guided-runtime-service";
import { screenResearchSources, sourceRelevanceBasis } from "../../src/application/research/guided-source-relevance";
const session = C.GuidedResearchSession.parse({ sessionId: "source-document", title: "Focus", brief: { topic: "Keyboard focus", goal: "Verify requirements", region: "Global", focus: "Accessibility", timeRange: "2026" }, stage: "brief", resumeStage: "brief", status: "active", progress: 0, sourceCount: 0, reportId: null, createdAt: "now", updatedAt: "now" });
function fixture() {
  const state = initialRuntime(session);
  state.outline = [{ id: "focus", title: "Focus", questions: ["What size applies?"], enabled: true, order: 0 }];
  state.tasks = [{ id: "task", sectionId: "focus", query: "official focus appearance", status: "succeeded", attempts: 1, errorCode: null }];
  const source = { id: "official", taskId: "task", title: "Official focus", url: "https://example.org/focus", content: "An introductory search excerpt.", retrievedAt: "now", decision: "accepted" as const,
    document: { url: "https://example.org/focus", text: "The verified requirement specifies a two pixel perimeter.", summary: "Verified document", contentHash: "captured", contentKind: "html" as const, retrievedAt: "now", truncated: false } };
  return { state, source };
}
function response(context: any, modify: (entry: any, chunks: any[]) => void = () => {}) {
  return { evaluations: context.chunks.map((chunk: any) => {
    const entry = { sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: false,
      presentation: { title: "焦点要求", summary: "来源提供可核对的焦点要求。" },
      matches: [{ questionId: chunk.questionIds[0], quoteRef: chunk.quoteOptions?.[0]?.quoteRef ?? "missing", insight: "The source directly supports the question.", relevance: "direct" }] };
    modify(entry, context.chunks); return entry;
  }) };
}
const complete = (modify?: (entry: any, chunks: any[]) => void) => vi.fn(async (_system: string, context: any, validate: (value: unknown) => void) => { const value = response(context, modify); validate(value); return value; });
describe("retrieved source document screening references", () => {
  it("screens already retrieved verified text instead of a thin search excerpt, preserving original source and presentation", async () => {
    const { state, source } = fixture(); const model = complete();
    const result = await screenResearchSources(state, [source], model);
    const chunk = model.mock.calls[0]![1].chunks[0];
    expect(chunk).not.toHaveProperty("content");
    expect(chunk.quoteOptions.map((option: any) => option.text).join(" ")).toContain(source.document.text);
    expect(result[0]).toMatchObject({ content: source.content, document: source.document, presentation: { title: "焦点要求" } });
    expect(source).not.toHaveProperty("relevanceBasis");
  });
  it("invalidates cached approval when actual verified text changes even if the claimed hash is unchanged", () => {
    const { state, source } = fixture();
    expect(sourceRelevanceBasis(state, source)).not.toBe(sourceRelevanceBasis(state, { ...source, document: { ...source.document, text: "A changed official requirement." } }));
  });
  it("falls back to the search excerpt before a document is retrieved", async () => {
    const { state, source } = fixture(); const { document: _document, ...unread } = source; const model = complete();
    expect(await screenResearchSources(state, [unread], model)).toHaveLength(1);
    expect(model.mock.calls[0]![1].chunks[0].quoteOptions[0].text).toBe(source.content);
  });
  it.each(["unknown", "foreign", "dual", "question", "presentation"])("rejects the entire batch for invalid %s references or metadata", async (kind) => {
    const { state, source } = fixture(); const other = { ...source, id: "other", document: { ...source.document, text: "Other verified requirement." } };
    const model = complete((entry, chunks) => {
      if (entry.sourceId !== source.id) return;
      if (kind === "unknown") entry.matches[0].quoteRef = "unknown";
      if (kind === "foreign") entry.matches[0].quoteRef = chunks.find((chunk) => chunk.sourceId === "other").quoteOptions?.[0]?.quoteRef ?? "foreign";
      if (kind === "dual") entry.matches[0].quote = source.document.text;
      if (kind === "question") entry.matches[0].questionId = "other-task-question";
      if (kind === "presentation") entry.presentation = { title: "", summary: "" };
    });
    await expect(screenResearchSources(state, [source, other], model)).rejects.toMatchObject({ reasonCode: "RESEARCH_SOURCE_RELEVANCE_INVALID" });
    expect(model).toHaveBeenCalledTimes(2); expect(state.sources).toEqual([]); expect(source).not.toHaveProperty("presentation");
  });
  it("keeps references stable on the same-batch repair without publishing the first partial result", async () => {
    const { state, source } = fixture(); let count = 0; const model = vi.fn(async (_system: string, context: any, validate: (value: unknown) => void) => {
      const value = response(context); if (++count === 1) value.evaluations[0].matches[0].quoteRef = "unknown";
      validate(value); return value;
    });
    expect(await screenResearchSources(state, [source], model)).toHaveLength(1);
    expect(model.mock.calls[0]![1].chunks).toEqual(model.mock.calls[1]![1].chunks);
    expect(model.mock.calls[1]![1]).toHaveProperty("repair");
  });
  it("retains verbatim literal compatibility and rejects a rewritten or cross-block quote", async () => {
    const { state, source } = fixture();
    const literal = (quote: string) => complete((entry) => { delete entry.matches[0].quoteRef; entry.matches[0].quote = quote; });
    expect(await screenResearchSources(state, [source], literal(source.document.text))).toHaveLength(1);
    await expect(screenResearchSources(state, [source], literal("The verified ... perimeter."))).rejects.toMatchObject({ reasonCode: "RESEARCH_SOURCE_RELEVANCE_INVALID" });
    const long = { ...source, document: { ...source.document, text: "x".repeat(6000) + source.document.text } };
    await expect(screenResearchSources(state, [long], literal(source.document.text))).rejects.toMatchObject({ reasonCode: "RESEARCH_SOURCE_RELEVANCE_INVALID" });
  });
  it("still rejects unrelated retrieved text instead of treating document availability as relevance", async () => {
    const { state, source } = fixture(); const unrelated = { ...source, document: { ...source.document, text: "Unrelated vehicle inventory." } };
    const model = complete((entry) => { entry.irrelevant = true; entry.matches = []; });
    expect(await screenResearchSources(state, [unrelated], model)).toEqual([]);
  });
});
