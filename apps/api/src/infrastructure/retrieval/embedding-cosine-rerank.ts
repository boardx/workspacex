import type { EmbeddingPort, RerankPort } from "../../application/retrieval/ports";

/**
 * Rerank by cosine similarity of the SAME embedding model that indexed the segments.
 *
 * WorkspaceX Local previously reranked through the deep-agent's `LLMListwiseRerank`, i.e. one
 * chat-model call per retrieval on a 4B model (#3749 B2.1). An embedding pass is ~50 ms per
 * candidate and needs no prompt. Ties keep the input order (the retriever's own ranking).
 * Selected with `KERNEL_RERANK_MODE=embedding`; cloud keeps the listwise reranker.
 */
export class EmbeddingCosineRerank implements RerankPort {
  constructor(private readonly embeddings: EmbeddingPort) {}

  async rerank(query: string, candidates: readonly { id: string; content: string }[]): Promise<readonly string[]> {
    if (candidates.length === 0) return [];
    const q = await this.embeddings.embed(query);
    const scored = await Promise.all(candidates.map(async (c, i) => ({ id: c.id, i, score: cosine(q, await this.embeddings.embed(c.content)) })));
    scored.sort((a, b) => b.score - a.score || a.i - b.i);
    return scored.map((s) => s.id);
  }
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}
