import { scopedSupplementQueries } from "./guided-supplement-task-scope";
import { fairTaskWork } from "./guided-task-work";
import { createHash, randomUUID } from "node:crypto";
import { research as C } from "@repo/contracts";
import { reportQuestions } from "./guided-report-evidence";
import { collectSourceDocuments } from "./guided-source-documents";
import { screenResearchSources, sourceRelevanceBasis, sourceTaskIds } from "./guided-source-relevance";
import { NegativeSourceScreenCache } from "./guided-negative-screen-cache";
import { isRecoverableSearchFailure, recoveryQueries } from "./guided-search-recovery";
import { supplementQuery } from "./guided-supplement-query";
import { ResearchRuntimeError, type GuidedSearchPort, type ResearchRuntime } from "./guided-runtime-ports";
import type { RuntimePersistence } from "./guided-report-stream";
import type { SearchBudget } from "./guided-search-budget";

type Task = ResearchRuntime["tasks"][number];
type Source = ResearchRuntime["sources"][number];
type Attempt = NonNullable<Task["searchAttempts"]>[number];
export type PipelineComplete = (system: string, context: unknown, validate: (value: unknown) => void,
  admit: (work: () => Promise<void>) => Promise<void>, check: () => void, signal: AbortSignal, relevance: boolean) => Promise<unknown>;
// Conservative execution caps reuse the existing search/read limit and screening limit.
const TASK_WORKERS = 3;
const MODEL_WORKERS = 2;
const READ_WORKERS = 3;

export function normalizedResearchUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid source URL");
    url.hash = "";
    return url.href;
  } catch { throw new ResearchRuntimeError("RESEARCH_SOURCE_URL_INVALID"); }
}

/** Initial search is shared within each chapter; confirmed questions remain
 * untouched and evidence screening still receives every question in that scope. */
export function tasksFromConfirmedQuestions(state: ResearchRuntime): Task[] {
  const sections = state.outline.filter(section => section.enabled);
  reportQuestions(sections); // Preserve the existing confirmed-question budget validation.
  const objectiveLimit = C.GuidedResearchTask.shape.objective.unwrap().maxLength!;
  return [...sections].sort((a, b) => a.order - b.order).map(section => C.GuidedResearchTask.parse({
    id: randomUUID(), sectionId: section.id, title: section.title,
    objective: (section.objective || section.title).slice(0, objectiveLimit),
    query: supplementQuery(state.brief.topic, state.brief.region, section.title),
    status: "pending", attempts: 0, errorCode: null,
  }));
}

/** A permit does not own the persistence lane; release before admitting more work. */
function permits(limit: number, check: () => void) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(work: () => Promise<T>): Promise<T> => {
    check();
    if (active >= limit) await new Promise<void>(resolve => waiting.push(resolve));
    else active++;
    try { check(); return await work(); }
    finally { const next = waiting.shift(); if (next) next(); else active--; }
  };
}

export type PipelineMetrics = { durationMs: number; firstSourceMs: number | null; taskCount: number; succeeded: number; failed: number; accepted: number; readable: number; modelCalls: number; materialUpgradesRejected: number };

/** Local task workers are computation closures, not durable agents. Only short
 * admissions/merges publish state; all issued callbacks drain before returning. */
export async function executeTaskPipeline(state: ResearchRuntime, persist: RuntimePersistence, search: GuidedSearchPort,
  budget: SearchBudget, complete: PipelineComplete, metrics?: (result: PipelineMetrics) => void): Promise<void> {
  const started = Date.now(), initialModels = state.modelCalls.length;
  const negativeCache = new NegativeSourceScreenCache();
  let firstSourceMs: number | null = null;
  let materialUpgradesRejected = 0;
  let stopped = false, failure: unknown;
  const abort = new AbortController();
  const signal = AbortSignal.any([budget.signal, abort.signal]);
  const stop = (error: unknown) => { if (!stopped) { stopped = true; failure = error; abort.abort(error); } };
  const check = () => { if (stopped) throw failure; budget.check(); };
  let writes = Promise.resolve();
  const commit = (work: () => Promise<void>) => {
    const next = writes.then(async () => {
      check();
      try { await work(); check(); }
      catch (error) { stop(error); throw error; }
    });
    writes = next;
    // A rejected lane remains poisoned; its owner observes the original error.
    void next.catch(() => {});
    return next;
  };
  const modelPermit = permits(MODEL_WORKERS, check), readPermit = permits(READ_WORKERS, check);
  const model = (relevance: boolean) => (system: string, context: unknown, validate: (value: unknown) => void, batchCheck?: () => void) =>
    modelPermit(() => complete(system, context, validate, commit, () => { check(); batchCheck?.(); }, signal, relevance));
  const documents = new Map<string, Promise<Awaited<ReturnType<NonNullable<GuidedSearchPort["read"]>>>>>();
  const read = async (url: string) => {
    const key = normalizedResearchUrl(url);
    let pending = documents.get(key);
    if (!pending) {
      pending = readPermit(async () => {
        const result = await budget.run(() => search.read!(url, { signal })); check();
        C.GuidedResearchDocument.parse({ ...result, url, retrievedAt: new Date().toISOString(), contentHash: createHash("sha256").update(result.text).digest("hex") });
        return result;
      });
      documents.set(key, pending);
      void pending.catch(() => { if (documents.get(key) === pending) documents.delete(key); });
    }
    const result = await pending; check(); return result;
  };
  const updateProgress = () => { state.progress = { executionVersion: state.version, stage: "searching", completed: state.tasks.filter(task => ["succeeded", "failed"].includes(task.status)).length, total: state.tasks.length }; };
  const save = async () => { updateProgress(); await persist(); persist.observe({ type: "snapshot", state: structuredClone(state) }); };
  const taskError = (error: unknown) => {
    const code = error instanceof ResearchRuntimeError ? error.reasonCode : "RESEARCH_SEARCH_UNAVAILABLE";
    return isRecoverableSearchFailure(code) ? "RESEARCH_SEARCH_UNAVAILABLE" : code;
  };
  const merge = (sources: Source[]) => {
    for (const hit of sources) {
      if (hit.decision === "excluded") continue;
      const existing = state.sources.find(source => normalizedResearchUrl(source.url) === normalizedResearchUrl(hit.url));
      if (existing?.decision === "excluded") continue;
      if (existing) {
        existing.taskIds = [...new Set([...sourceTaskIds(existing), ...sourceTaskIds(hit)])];
        const changedMaterial = !existing.document && hit.document && existing.content !== hit.document.text;
        if (!existing.document && hit.document) { existing.document = hit.document; delete existing.documentError; }
        else if (!existing.document && hit.documentError) existing.documentError = hit.documentError;
        if (changedMaterial) {
          if (hit.presentation) existing.presentation = hit.presentation; else delete existing.presentation;
        } else if (!existing.presentation && hit.presentation) existing.presentation = hit.presentation;
        if (!existing.addedByUser) existing.relevanceBasis = sourceRelevanceBasis(state, existing);
      } else state.sources.push(hit);
    }
  };
  // A shared URL has one stored material. Reserve overlapping URL sets in sorted
  // order, then select current bytes only after earlier work has committed them.
  // These permits never own the state/persistence lane while awaiting a model.
  const urlTails = new Map<string, Promise<void>>();
  const lockUrls = async (urls: readonly string[]) => {
    const releases: Array<() => void> = [];
    const release = () => { for (const unlock of releases.reverse()) unlock(); releases.length = 0; };
    try {
      for (const key of [...new Set(urls.map(normalizedResearchUrl))].sort()) {
        check();
        const previous = urlTails.get(key) ?? Promise.resolve();
        let unlock!: () => void;
        const tail = new Promise<void>(resolve => { unlock = resolve; });
        urlTails.set(key, tail);
        releases.push(() => { unlock(); if (urlTails.get(key) === tail) urlTails.delete(key); });
        await previous; check();
      }
      return release;
    } catch (error) { release(); throw error; }
  };
  const readAndScreen = async (candidates: Source[], task?: Task) => {
    const previous = new Map(candidates.flatMap(source => {
      const stored = state.sources.find(item => item.id === source.id);
      return stored ? [[source.id, structuredClone(stored)] as const] : [];
    }));
    if (search.read) await collectSourceDocuments(candidates, read, async () => {}, { signal, retryTransient: true });
    check();
    const upgraded = candidates.filter(source => !previous.get(source.id)?.document && source.document && previous.has(source.id));
    for (const source of upgraded) {
      source.taskIds = [...new Set([...sourceTaskIds(previous.get(source.id)!), ...sourceTaskIds(source)])];
      source.addedByUser = false;
      delete source.presentation;
    }
    const screened = await screenResearchSources(state, candidates, model(true), { adaptive: true, signal, negativeCache }); check();
    const denied = upgraded.filter(source => {
      const retained = screened.find(item => item.id === source.id);
      const required = [...sourceTaskIds(previous.get(source.id)!), ...(task ? [task.id] : [])];
      return !retained || required.some(id => !sourceTaskIds(retained).includes(id));
    });
    if (!denied.length) return screened;
    materialUpgradesRejected += denied.length;
    const fallback = denied.map(source => {
      const stored = previous.get(source.id)!;
      // A rejected new body cannot erase an old approval. New associations still
      // require evaluation against the immutable bytes that remain stored.
      return task && !sourceTaskIds(stored).includes(task.id)
        ? { ...stored, taskId: task.id, taskIds: [task.id], addedByUser: false } : stored;
    });
    const retained = task ? await screenResearchSources(state, fallback, model(true), { adaptive: true, signal, negativeCache }) : fallback;
    check();
    return [...screened.filter(source => !denied.some(item => item.id === source.id)), ...retained];
  };
  const compute = async (task: Task, query: string): Promise<{ sources: Source[]; errorCode: string | null; release: () => void }> => {
    check();
    const hits = await budget.run(() => search.search(query, { signal })); check();
    if (!hits.length) return { sources: [], errorCode: "RESEARCH_SEARCH_EMPTY", release: () => {} };
    const release = await lockUrls(hits.map(hit => hit.url));
    try {
      const candidates = [...new Map(hits.map(hit => {
        const key = normalizedResearchUrl(hit.url);
        const existing = state.sources.find(source => normalizedResearchUrl(source.url) === key);
        const source: Source = existing ? structuredClone(existing) : C.GuidedResearchSource.parse({ ...hit, id: randomUUID(), taskId: task.id, taskIds: [task.id], retrievedAt: new Date().toISOString(), decision: "accepted" });
        const cached = existing?.relevanceBasis === sourceRelevanceBasis(state, source) && sourceTaskIds(source).includes(task.id);
        return [key, source.decision === "excluded" || cached ? source : { ...source, taskId: task.id, taskIds: [task.id], addedByUser: false }] as const;
      })).values()];
      const sources = await readAndScreen(candidates, task);
      return { sources, errorCode: sources.some(source => source.decision !== "excluded" && sourceTaskIds(source).includes(task.id)) ? null : "RESEARCH_SEARCH_NO_RELEVANT_SOURCES", release };
    } catch (error) { release(); throw error; }
  };
  const attempt = async (task: Task, query: string, primary: boolean) => {
    let record!: Attempt;
    await commit(async () => {
      record = { query, status: "running", errorCode: null };
      task.searchAttempts ??= []; task.searchAttempts.push(record);
      if (primary) { task.status = "running"; task.errorCode = null; }
      await save();
    });
    let result: { sources: Source[]; errorCode: string | null };
    let release = () => {};
    try { const computed = await compute(task, query); result = computed; release = computed.release; }
    catch (error) { check(); result = { sources: [], errorCode: taskError(error) }; }
    try { await commit(async () => {
      merge(result.sources);
      record.status = result.errorCode ? "failed" : "succeeded"; record.errorCode = result.errorCode;
      if (primary) { task.status = record.status; task.errorCode = record.errorCode; }
      await save();
      if (result.sources.some(source => source.decision === "accepted") && firstSourceMs === null) firstSourceMs = Date.now() - started;
    }); } finally { release(); }
    return result.errorCode;
  };
  const sectionOrder = new Map(state.outline.map(section => [section.id, section.order]));
  const ordered = [...state.tasks].sort((a, b) => (sectionOrder.get(a.sectionId) ?? Infinity) - (sectionOrder.get(b.sectionId) ?? Infinity));
  const work = async (task: Task) => {
    if (task.status === "succeeded") return false;
    const previousError = task.searchAttempts?.at(-1)?.errorCode ?? task.errorCode;
    await commit(async () => { task.attempts++; task.searchAttempts ??= []; await save(); });
    let errorCode = previousError;
    if (task.searchAttempts!.length < C.GUIDED_RESEARCH_SEARCH_ATTEMPT_LIMIT && !(task.searchAttempts!.length && isRecoverableSearchFailure(previousError))) {
      errorCode = await attempt(task, task.searchAttempts!.at(-1)?.query ?? task.query, true);
    }
    return isRecoverableSearchFailure(errorCode) && task.searchAttempts!.length < C.GUIDED_RESEARCH_SEARCH_ATTEMPT_LIMIT;
  };
  const recover = async (task: Task) => {
    let queries: string[];
    try { queries = await recoveryQueries(state, task, model(false)); check(); }
    catch (error) {
      check(); await commit(async () => { task.status = "failed"; task.errorCode = taskError(error); await save(); }); return;
    }
    for (const query of queries.slice(0, C.GUIDED_RESEARCH_SEARCH_ATTEMPT_LIMIT - task.searchAttempts!.length)) {
      check(); if (!isRecoverableSearchFailure(await attempt(task, query, true))) break;
    }
  };
  const workers = async <T>(items: readonly T[], run: (item: T) => Promise<void>) => {
    let cursor = 0;
    const worker = async () => {
      while (!stopped && cursor < items.length) {
        const item = items[cursor++]!;
        try { check(); await run(item); }
        catch (error) { stop(error); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(TASK_WORKERS, items.length) }, worker));
    check();
  };
  try {
    // Stable plan order is an execution boundary, not only a dispatch sort.
    // Unknown/legacy task sections remain in the tail rather than disappearing.
    const groups = new Map<string, { section?: ResearchRuntime["outline"][number]; tasks: Task[] }>();
    for (const section of [...state.outline].sort((a, b) => a.order - b.order)) {
      if (!groups.has(section.id)) groups.set(section.id, { section, tasks: [] });
    }
    for (const task of ordered) {
      if (!groups.has(task.sectionId)) groups.set(task.sectionId, { tasks: [] });
      groups.get(task.sectionId)!.tasks.push(task);
    }
    const pendingSources = state.sources.filter(source => source.decision === "accepted" && !source.document && (!source.documentError || source.documentError === "unavailable"));
    const sourceGroups = new Map([...groups.keys()].map(id => [id, [] as Source[]]));
    const unscopedSources: Source[] = [];
    for (const source of pendingSources) {
      // Shared material belongs to its earliest associated plan; review it once.
      const ids = new Set(sourceTaskIds(source));
      const owner = [...groups].find(([, group]) => group.tasks.some(task => ids.has(task.id)));
      if (owner) sourceGroups.get(owner[0])!.push(source);
      else unscopedSources.push(source);
    }
    const reviewPersisted = async (sources: Source[]) => {
      if (!search.read) return;
      await workers(sources, async source => {
        const release = await lockUrls([source.url]);
        try {
          const reviewed = await readAndScreen([structuredClone(source)]);
          await commit(async () => { merge(reviewed); await save(); });
        } finally { release(); }
      });
    };
    for (const [sectionId, { section, tasks }] of groups) {
      check();
      await reviewPersisted(sourceGroups.get(sectionId)!);
      await fairTaskWork(tasks, TASK_WORKERS, work, recover, check, stop);
      // The chapter's existing supplements finish in the same boundary. Shared
      // provider/read/cache limits still belong to the entire execution.
      if (search.read && section?.enabled) {
        const count = () => new Set(state.sources.filter(source => source.decision === "accepted" && source.document && sourceTaskIds(source).some(id => state.tasks.find(item => item.id === id)?.sectionId === section.id)).map(source => normalizedResearchUrl(source.url))).size;
        for (const { task, query } of scopedSupplementQueries(state, section, ordered)) {
          check(); if (count() >= 3) break;
          if ((task.searchAttempts ?? []).some(record => record.query.trim().toLowerCase() === query.trim().toLowerCase()) || (task.searchAttempts?.length ?? 0) >= C.GUIDED_RESEARCH_SEARCH_ATTEMPT_LIMIT) continue;
          await attempt(task, query, false);
        }
      }
      await writes; check();
    }
    // Legacy/user sources without a task association must not preempt plan work.
    await reviewPersisted(unscopedSources);
    if (state.tasks.some(task => task.status === "failed")) throw new ResearchRuntimeError("RESEARCH_SEARCH_PARTIAL_FAILURE");
  } catch (error) {
    // All workers have drained. Mark issued work interrupted before the service's
    // terminal write; undispatched pending tasks and trusted successes stay intact.
    const code = error instanceof ResearchRuntimeError ? error.reasonCode : "RESEARCH_SEARCH_UNAVAILABLE";
    for (const task of state.tasks) {
      if (task.status === "running") { task.status = "failed"; task.errorCode = code; }
      for (const record of task.searchAttempts ?? []) if (record.status === "running") { record.status = "failed"; record.errorCode = code; }
    }
    throw error;
  } finally {
    negativeCache.clear();
    // Model diagnostics are metadata only; no queries, excerpts, URLs or response bodies.
    try { metrics?.({ durationMs: Date.now() - started, firstSourceMs, taskCount: state.tasks.length, succeeded: state.tasks.filter(task => task.status === "succeeded").length,
      failed: state.tasks.filter(task => task.status === "failed").length, accepted: state.sources.filter(source => source.decision === "accepted").length,
      readable: state.sources.filter(source => source.decision === "accepted" && source.document).length, modelCalls: state.modelCalls.length - initialModels, materialUpgradesRejected }); }
    catch { /* Optional diagnostics cannot replace the original execution result. */ }
  }
}
