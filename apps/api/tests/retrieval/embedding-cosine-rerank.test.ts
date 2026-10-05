/** #3749 B2.1: reranking by the embedding model's cosine, ties keep retriever order. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmbeddingCosineRerank, cosine } from "../../src/infrastructure/retrieval/embedding-cosine-rerank";

import {LangChainEmbeddingClient} from "../../src/infrastructure/retrieval/langchain-embedding-client";
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
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

function accountedFixture(){
 vi.stubEnv('KERNEL_RETRIEVAL_REQUEST_ACCOUNTING_ENABLED','1');vi.stubEnv('KERNEL_AI_PRODUCT_QUOTA_ENABLED','0');
 const fetch=vi.fn(async(_url:string,init:RequestInit)=>{const text=JSON.parse(init.body as string).texts[0];return new Response(JSON.stringify({model:'physical',modelVersion:'v1',vectors:[vec[text]??[1,0]]}),{headers:{'content-type':'application/json'}});});vi.stubGlobal('fetch',fetch);
 return {fetch,reranker:new EmbeddingCosineRerank(new LangChainEmbeddingClient({baseUrl:'http://service.example.test',internalKey:'private-key',model:'physical',modelVersion:'v1'}))};
}
const ref={orgId:'org-A',runId:'root-A',attemptId:'root-A:0',leaseEpoch:1};
it('query and every candidate embedding carry the same trusted run to existing private transport',async()=>{
 const f=accountedFixture();expect(await f.reranker.rerank('q',[{id:'a',content:'a'},{id:'b',content:'b'}],ref)).toEqual(['a','b']);
 expect(f.fetch).toHaveBeenCalledTimes(3);
 for(const call of f.fetch.mock.calls){const body=JSON.parse(call[1].body as string);expect(body.accounting).toEqual(ref);expect(Object.keys(body.accounting).sort()).toEqual(['attemptId','leaseEpoch','orgId','runId']);expect(JSON.stringify(body)).not.toContain('private-key');}
});
it('missing, invalid or asserted actor fails before query/candidate service HTTP',async()=>{
 const f=accountedFixture(),candidates=[{id:'a',content:'a'}];
 for(const bad of [undefined,{...ref,leaseEpoch:0},{...ref,userId:'forged'}])await expect(f.reranker.rerank('q',candidates,bad as never)).rejects.toThrow();
 expect(f.fetch).not.toHaveBeenCalled();expect(await f.reranker.rerank('q',[],ref)).toEqual([]);expect(f.fetch).not.toHaveBeenCalled();
});
it('concurrent tenant reranks do not exchange query or candidate accounting contexts',async()=>{
 const f=accountedFixture(),other={orgId:'org-B',runId:'root-B',attemptId:'root-B:2',leaseEpoch:3};
 await Promise.all([f.reranker.rerank('q-A',[{id:'a',content:'candidate-A'}],ref),f.reranker.rerank('q-B',[{id:'b',content:'candidate-B'}],other)]);
 expect(f.fetch).toHaveBeenCalledTimes(4);
 for(const call of f.fetch.mock.calls){const body=JSON.parse(call[1].body as string);expect(body.accounting).toEqual(body.texts[0].endsWith('-A')?ref:other);}
});
