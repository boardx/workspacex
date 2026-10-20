/** Controlled scheduler comparison, NOT real-model or production latency evidence.
 * Run from apps/api: pnpm exec tsx scripts/benchmark-research-report-pipeline.ts
 * The old scheduler is loaded with current evidence validators to isolate scheduling.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generateReportChapters } from "../src/application/research/guided-report-chapters";
import type { ResearchRuntime } from "../src/application/research/guided-runtime-ports";
import type { RuntimePersistence } from "../src/application/research/guided-report-stream";
import type { ModelCallInput, ModelCallPort } from "../src/application/agent-run/ports";
import { guidedResearchReply } from "./loopback-guided-research";
const base = process.argv[2] ?? "305c629c4";
const baselineFile = resolve(`src/application/research/guided-report-chapters-benchmark-${process.pid}.ts`);
function fixture(): ResearchRuntime {
  const text = "Official controlled evidence: the grid connection policy requires an application and local verification.";
  return { sessionId: "benchmark", version: 1, revision: 1, currentNode: "report", availableNodes: ["report"],
    brief: { topic: "Policy", goal: "Compare", region: "EU", timeRange: "2026", focus: "Requirements" }, directions: [],
    outline: ["first", "second", "third"].map((id, order) => ({ id, title: `${id} policy`, order, enabled: true, questions: [`What are the ${id} requirements?`] })),
    tasks: ["first", "second", "third"].map(id => ({ id: `task-${id}`, sectionId: id, query: `${id} requirements`, status: "succeeded", attempts: 1, errorCode: null })),
    sources: ["first", "second", "third"].map(id => ({ id: `source-${id}`, taskId: `task-${id}`, title: `${id} source`, content: text,
      url: `https://example.org/${id}`, retrievedAt: "2026-10-20", decision: "accepted", document: { text, url: `https://example.org/${id}`, contentHash: createHash("sha256").update(text).digest("hex"), retrievedAt: "2026-10-20", contentKind: "text", truncated: false, summary: text } })),
    report: null, completed: false, busy: true, leaseUntil: null, errorCode: null, generatedNodes: [], messages: [], proposal: null, modelCalls: [] };
}
async function sample(label: string, generate: typeof generateReportChapters, state = fixture(), fixedLatency = false) {
  const started = performance.now();
  let firstProse: number | undefined, firstApproved: number | undefined, active = 0, peak = 0, calls = 0, evidenceCalls = 0, inputCharacters = 0, outputCharacters = 0;
  const reply = async (input: ModelCallInput, emit?: (delta: string) => Promise<void>) => {
    calls++; active++; peak = Math.max(peak, active); inputCharacters += input.user.length + input.system.length;
    try {
      const c = JSON.parse(input.user);
      const sections = [...new Set<string>((c.questions ?? []).map((q: { sectionId: string }) => q.sectionId))];
      const delay = c.reportStage === "evidence" ? (evidenceCalls++, fixedLatency ? 80 : 20 + sections.reduce((sum, id) => sum + (id === "first" ? 30 : 150), 0)) : 15;
      await new Promise(resolve => setTimeout(resolve, delay));
      const text = guidedResearchReply(input.system, input.user);
      if (!text) throw new Error("Unsupported controlled request");
      if (emit) { await emit(text); if (c.reportStage === "chapter") firstProse ??= performance.now() - started; }
      outputCharacters += text.length;
      return { text };
    } finally { active--; }
  };
  const model: ModelCallPort = { configurationIdentity: "controlled-5848", complete: input => reply(input), completeStream: (input, emit) => reply(input, emit) };
  const persist: RuntimePersistence = Object.assign(async () => {
    if (state.reportCheckpoint?.chapters.length) firstApproved ??= performance.now() - started;
  }, { requestId: "controlled", observe: () => {} });
  const report = await generate(state, model, { provider: "controlled", id: "controlled" }, persist);
  return { result: { label, firstProseMs: firstProse, firstApprovedMs: firstApproved, totalMs: performance.now() - started, calls, evidenceCalls, peak, inputCharacters, outputCharacters, chapters: report.sections.length, qualityWarnings: state.reportQualityWarnings?.length ?? 0 }, state };
}
try {
  const source = execFileSync("git", ["show", `${base}:apps/api/src/application/research/guided-report-chapters.ts`], { encoding: "utf8" });
  await writeFile(baselineFile, source, { flag: "wx" });
  const old = (await import(pathToFileURL(baselineFile).href)).generateReportChapters as typeof generateReportChapters;
  const baseline = await sample("baseline scheduler", old);
  const cold = await sample("pipeline cold", generateReportChapters);
  const warm = await sample("pipeline matching evidence", generateReportChapters, cold.state);
  const many = () => {
    const state = fixture(); const original = state.sources[0]!;
    state.sources = Array.from({ length: 43 }, (_, i) => {
      const text = `${original.document!.text} Unique source ${i}.`;
      return { ...structuredClone(original), id: `source-${i}`, url: `https://example.org/source-${i}`,
        document: { ...original.document!, text, contentHash: createHash("sha256").update(text).digest("hex") } };
    });
    return state;
  };
  const manyBaseline = await sample("43 sources baseline fixed request latency", old, many(), true);
  const manyCold = await sample("43 sources pipeline fixed request latency", generateReportChapters, many(), true);
  console.log(JSON.stringify({ controlled: true, realModel: false, baselineRevision: base, latencyModel: "20ms evidence overhead plus 30/150/150ms per chapter; 15ms per prose/review/synthesis; source-heavy scenario uses fixed80ms per evidence request", results: [baseline.result, cold.result, warm.result, manyBaseline.result, manyCold.result] }, null, 2));
} finally { await unlink(baselineFile).catch(() => {}); }
