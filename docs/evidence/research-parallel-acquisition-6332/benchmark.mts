import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { executeTaskPipeline as current } from '../../../apps/api/src/application/research/guided-task-pipeline';
import { SearchBudget } from '../../../apps/api/src/application/research/guided-search-budget';
import type { ResearchRuntime } from '../../../apps/api/src/application/research/guided-runtime-ports';
import type { RuntimePersistence } from '../../../apps/api/src/application/research/guided-report-stream';
import { guidedResearchReply } from '../../../apps/api/scripts/loopback-guided-research';
const { executeTaskPipeline: baseline } = await import(pathToFileURL(process.argv[2]!).href);
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function measure(run: typeof current) {
  const state: ResearchRuntime = { sessionId: 'benchmark', version: 1, revision: 0, currentNode: 'research', availableNodes: ['research'],
    brief: { topic: 'Grid policy', goal: 'Compare', region: 'EU', focus: 'Evidence', timeRange: '2026' }, directions: [],
    outline: Array.from({length: 6}, (_, order) => ({id: `s${order}`, title: 'Policy', questions: ['What applies?'], order, enabled: true})),
    tasks: Array.from({length: 6}, (_, i) => ({id: `t${i}`, sectionId: `s${i}`, query: `q${i}`, status: 'pending', attempts: 0, errorCode: null})),
    sources: [], report: null, busy: true, completed: false, generatedNodes: [], messages: [], modelCalls: [], proposal: null, errorCode: null, leaseUntil: null };
  let modelCalls = 0, searches = 0, reads = 0, writes = 0, activeReads = 0, peakReads = 0;
  const persist: RuntimePersistence = Object.assign(async () => { writes++; }, {requestId: 'benchmark', observe: () => {}});
  const budget = SearchBudget.perCall();
  const start = performance.now();
  try {
    await run(state, persist, {
      search: async query => { searches++; await sleep(60); return Array.from({length: 3}, (_, i) => ({title: 'Policy', url: `https://example.org/${query}/${i}`, content: 'Grid policy evidence from primary documents.'})); },
      read: async () => { reads++; peakReads = Math.max(peakReads, ++activeReads); await sleep(20); activeReads--; return {text: 'Grid policy evidence from primary documents.', contentKind: 'text', truncated: false}; },
    }, budget, async (system, context, validate) => {
      modelCalls++; await sleep(10);
      const output = JSON.parse(guidedResearchReply(`You are a research assistant. ${system}`, JSON.stringify(context))!);
      validate(output); return output;
    });
    return {durationMs: Math.round(performance.now()-start), searches, reads, modelCalls, writes, peakReads,
      succeeded: state.tasks.filter(t=>t.status==='succeeded').length, documents: state.sources.filter(s=>s.document).length,
      urls: state.sources.map(s => s.url).sort()};
  } finally { budget.dispose(); }
}
for (let trial = 1; trial <= 3; trial++) {
  const oldResult = await measure(baseline), newResult = await measure(current);
  if (JSON.stringify(oldResult.urls) !== JSON.stringify(newResult.urls)) throw new Error('Source outcomes changed');
  console.log(JSON.stringify({trial, baseline: oldResult, current: newResult}));
}
