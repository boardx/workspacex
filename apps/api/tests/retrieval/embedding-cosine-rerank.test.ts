/** #3749 B2.1: reranking by the embedding model's cosine, ties keep retriever order. */
import { describe, expect, it } from "vitest";
import { EmbeddingCosineRerank, cosine } from "../../src/infrastructure/retrieval/embedding-cosine-rerank";

const vec: Record<string, number[]> = { q: [1, 0], a: [0.9, 0.1], b: [0, 1], c: [0.9, 0.1] };
const embeddings = { model: "m", modelVersion: "v", embed: async (t: string) => vec[t] ?? [0, 0] };

describe("EmbeddingCosineRerank", () => {
  it("orders by cosine to the query and keeps input order on ties", async () => {
    const r = new EmbeddingCosineRerank(embeddings);
    expect(await r.rerank("q", [{ id: "b", content: "b" }, { id: "c", content: "c" }, { id: "a", content: "a" }])).toEqual(["c", "a", "b"]);
    expect(await r.rerank("q", [])).toEqual([]);
  });
  it("cosine handles zero vectors and length mismatch", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([0, 0], [1, 0])).toBe(0);
    expect(cosine([1, 0, 5], [1, 0])).toBeCloseTo(1, 5); // extra dims beyond the shorter vector are ignored
  });
});
