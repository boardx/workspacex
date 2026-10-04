import { describe, expect, it, vi } from "vitest";
import { research as C } from "@repo/contracts";
import { initialRuntime } from "../../src/application/research/guided-runtime-service";
import { recoveryQueries } from "../../src/application/research/guided-search-recovery";

const session = C.GuidedResearchSession.parse({ sessionId: "scope", title: "Public API research", brief: { topic: "Public API behavior", goal: "Answer confirmed questions", region: "Global", focus: "Official sources", timeRange: "Current" }, stage: "researching", resumeStage: "researching", status: "active", progress: 0, sourceCount: 0, reportId: null, createdAt: "now", updatedAt: "now" });
async function queries(original: string, recovered: string[], previous: string[] = []) {
  const state = initialRuntime(session);
  const task = C.GuidedResearchTask.parse({ id: "task", sectionId: "section", query: original, status: "failed", attempts: 1, errorCode: "RESEARCH_SEARCH_EMPTY" });
  task.searchAttempts = previous.map(query => ({ query, status: "failed", errorCode: "RESEARCH_SEARCH_EMPTY" }));
  state.tasks = [task];
  const model = vi.fn(async (_system: string, _context: unknown, validate: (value: unknown) => void) => { const output = { queries: recovered }; validate(output); return output; });
  const result = await recoveryQueries(state, task, model);
  if (result.length === 0 && /\bOR\b|\bNOT\b/.test(original)) expect(model).not.toHaveBeenCalled();
  return result;
}

describe("recovery retains explicit confirmed query site constraints", () => {
  it.each(["site:nodejs.org Buffer.alloc difference", "site:other.example Buffer.alloc difference", "Buffer.alloc difference"])("retains the confirmed site path when a recovery broadens or drops it: %s", async candidate => {
    const result = await queries("site:nodejs.org/api/buffer.html Buffer allocation methods?", [candidate]);
    expect(result).toEqual(["(Buffer.alloc difference) site:nodejs.org/api/buffer.html"]);
  });
  it("retains multiple OR sites and global exclusions", async () => {
    expect(await queries("(site:official.example/API OR site:standards.example/spec) -site:official.example/archive original question", ["site:unrelated.example short evidence"])).toEqual(["(short evidence) (site:official.example/API OR site:standards.example/spec) -site:official.example/archive"]);
  });
  it("retains AND site terms rather than changing them to an OR union", async () => {
    expect(await queries("site:official.example site:official.example/API original", ["short evidence"])).toEqual(["(short evidence) site:official.example site:official.example/API"]);
  });
  it("retains negative-only exclusions without inventing a positive site", async () => {
    expect(await queries("-site:archive.example original", ["site:new.example evidence"])).toEqual(["(evidence) -site:archive.example"]);
  });
  it("preserves literal scheme, fragment, URL encoding and path case", async () => {
    expect(await queries('site:"https://OFFICIAL.example/API%2FCase.html#Section" original', ["site:official.example/api/case.html alternative"])).toEqual(['(alternative) site:"https://OFFICIAL.example/API%2FCase.html#Section"']);
  });
  it("does not add site constraints to unscoped tasks", async () => {
    expect(await queries("original topic", ["topic official evidence", "site:official.example topic study"])).toEqual(["topic official evidence", "site:official.example topic study"]);
  });
  it("deduplicates after restoring scope and skips an already attempted query", async () => {
    expect(await queries("(same words) site:official.example/API", ["site:other.example same words", "site:official.example alternative"])).toEqual(["(alternative) site:official.example/API"]);
  });
  it("does not silently change a mixed site boolean expression", async () => {
    expect(await queries("(site:a.example OR site:b.example) site:c.example original", ["alternative"])).toEqual([]);
  });
  it("does not retry the exact initial site-first query after scope is repositioned", async () => {
    expect(await queries("site:official.example/API same words", ["site:official.example/API same words"])).toEqual([]);
  });
  it("uses case-insensitive hosts but distinct case-sensitive paths in attempt deduplication", async () => {
    expect(await queries("site:OFFICIAL.example/API original", ["same words"], ["(same words) site:official.example/api"])).toEqual(["(same words) site:OFFICIAL.example/API"]);
    expect(await queries("site:OFFICIAL.example/API original", ["same words"], ["(same words) site:official.example/API"])).toEqual([]);
  });
  it("does not retry a fully parenthesized equivalent query", async () => {
    expect(await queries("site:official.example/API same words", ["(same words)"])).toEqual([]);
  });

  it("does not interpret quoted site literals as confirmed constraints", async () => {
    expect(await queries('meaning of "site:archive.example" operator', ["search operator documentation"])).toEqual(["search operator documentation"]);
  });
  it("retains quoted keywords when restoring a real site scope", async () => {
    expect(await queries('site:official.example original', ['meaning of "site:other.example"'])).toEqual(['(meaning of "site:other.example") site:official.example']);
  });

  it.each([
    "-(site:a.example OR site:b.example) topic",
    "NOT site:a.example topic",
    "site:a.example topic OR other",
    "(site:a.example topic) OR (other -site:b.example)",
    "-site:a.example OR -site:b.example topic",
    "(-site:archive.example site:a.example) OR site:b.example topic",
    "site:a.example OR site:b.example -site:archive.example topic",
  ])("does not globalize a branch-local or ambiguous Boolean constraint: %s", async original => {
    expect(await queries(original, ["alternative evidence"])).toEqual([]);
  });

});
