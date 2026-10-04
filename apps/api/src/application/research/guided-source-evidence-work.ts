import { research as C } from "@repo/contracts";

export type SourceEvidenceChunk = { sourceId: string; chunkId: string; taskId: string; questionIds: string[]; title: string; url: string; content: string };
export const SOURCE_SCREEN_CHUNK_CHARS = 6000;
export const SOURCE_SCREEN_BATCH_CHARS = 24000;
export const SOURCE_SCREEN_BATCH_CHUNKS = C.GuidedResearchEvidenceModelOutput.shape.evaluations._def.maxLength!.value;
type Term = { text: string; weight: number };

/** Ranking alone never establishes relevance. Bound lexical work; when there
 * are no useful terms the stable original chunk order remains the fallback. */
export function sourceEvidenceTerms(parts: readonly { text: string; weight: number }[]): Term[] {
  const terms = new Map<string, number>();
  for (const part of parts) {
    for (const word of part.text.toLowerCase().match(/[a-z0-9]{2,}|[\u3400-\u9fff]{2,}/g) ?? []) {
      const words = /^[a-z0-9]/.test(word) ? [word] : Array.from({ length: Math.max(0, word.length - 1) }, (_, index) => word.slice(index, index + 2));
      for (const text of words) {
        if (!terms.has(text) && terms.size >= 256) continue;
        terms.set(text, Math.max(terms.get(text) ?? 0, part.weight));
      }
    }
  }
  return [...terms].map(([text, weight]) => ({ text, weight }));
}

export function sourceScreenBatches(chunks: readonly SourceEvidenceChunk[]): SourceEvidenceChunk[][] {
  const batches: SourceEvidenceChunk[][] = [];
  let size = 0;
  for (const chunk of chunks) {
    let batch = batches.at(-1);
    if (!batch || batch.length === SOURCE_SCREEN_BATCH_CHUNKS || size + chunk.content.length > SOURCE_SCREEN_BATCH_CHARS) {
      batch = []; batches.push(batch); size = 0;
    }
    batch.push(chunk); size += chunk.content.length;
  }
  return batches;
}

/** One next batch at a time, fair across source/task scopes. Probe one ranked
 * chunk first, then grow a fully negative probe to two and the full-size window.
 * Only the caller's
 * strictly validated positive chunk IDs can stop that exact scope's remainder. */
export function adaptiveSourceEvidenceWork(chunks: readonly SourceEvidenceChunk[], terms: ReadonlyMap<string, readonly Term[]>) {
  const key = (chunk: SourceEvidenceChunk) => JSON.stringify([chunk.sourceId, chunk.taskId]);
  const queues = new Map<string, Array<{ chunk: SourceEvidenceChunk; score: number; index: number }>>();
  for (const [index, chunk] of chunks.entries()) {
    const content = chunk.content.toLowerCase();
    const score = (terms.get(chunk.taskId) ?? []).reduce((sum, term) => sum + (content.includes(term.text) ? term.weight : 0), 0);
    const queue = queues.get(key(chunk)) ?? [];
    queue.push({ chunk, score, index }); queues.set(key(chunk), queue);
  }
  const scopes = [...queues].map(([scope, queue]) => ({ scope, queue: queue.sort((a, b) => b.score - a.score || a.index - b.index), cursor: 0, probeLimit: 1 }));
  const positive = new Set<string>();
  let cursor = 0;
  return {
    next(): SourceEvidenceChunk[] | null {
      const batch: SourceEvidenceChunk[] = []; let size = 0;
      const supplied = new Map<string, number>();
      while (batch.length < SOURCE_SCREEN_BATCH_CHUNKS) {
        let found = false;
        for (let scanned = 0; scanned < scopes.length; scanned++) {
          const scope = scopes[cursor++ % scopes.length]!;
          const item = scope.queue[scope.cursor];
          if (positive.has(scope.scope) || !item || (supplied.get(scope.scope) ?? 0) >= scope.probeLimit
            || size + item.chunk.content.length > SOURCE_SCREEN_BATCH_CHARS) continue;
          batch.push(item.chunk); size += item.chunk.content.length; scope.cursor++;
          supplied.set(scope.scope, (supplied.get(scope.scope) ?? 0) + 1); found = true; break;
        }
        if (!found) break;
      }
      return batch.length ? batch : null;
    },
    approve(batch: readonly SourceEvidenceChunk[], chunkIds: readonly string[]) {
      // Expand only scopes whose current probe completed without a positive.
      // A first positive avoids sending the rest of that source/task material.
      for (const id of chunkIds) {
        const chunk = batch.find(item => item.chunkId === id);
        if (chunk) positive.add(key(chunk));
      }
      for (const scope of scopes) {
        const count = batch.filter(chunk => key(chunk) === scope.scope).length;
        if (!positive.has(scope.scope) && count >= scope.probeLimit) scope.probeLimit = Math.min(Math.floor(SOURCE_SCREEN_BATCH_CHARS / SOURCE_SCREEN_CHUNK_CHARS), scope.probeLimit * 2);
      }
    },
  };
}
