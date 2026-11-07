import {afterEach,describe,expect,it,vi} from "vitest";
import {LangChainEmbeddingClient} from "../../src/infrastructure/retrieval/langchain-embedding-client";
import {LangChainRerankClient} from "../../src/infrastructure/retrieval/langchain-rerank-client";
import {RetrievalEmbeddingRequest} from "@repo/contracts/retrieval-embedding";
import {RetrievalRerankRequest} from "@repo/contracts/retrieval-rerank";
const ref={orgId:"org-A",runId:"root-A",attemptId:"root-A:0",leaseEpoch:1};
const config={baseUrl:"http://service.example.test",internalKey:"private-service-key",model:"physical",modelVersion:"v1"};
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
for(const kind of ["embedding","rerank"] as const)describe(`${kind} private accounting propagation`,()=>{
 function fixture(){
  const fetch=vi.fn(async(_url:string,_init?:RequestInit)=>new Response(JSON.stringify(kind==="embedding"?{model:"physical",modelVersion:"v1",vectors:[[1,0]]}:{model:"physical",modelVersion:"v1",ids:["a"]}),{headers:{"content-type":"application/json"}}));vi.stubGlobal("fetch",fetch);
  const client=kind==="embedding"?new LangChainEmbeddingClient(config):new LangChainRerankClient(config);
  const call=(accounting?:typeof ref)=>kind==="embedding"?(client as LangChainEmbeddingClient).embed("transient-query",accounting):(client as LangChainRerankClient).rerank("transient-query",[{id:"a",content:"authorized-evidence"}],accounting);
  return {fetch,call};
 }
 it("accounting is mandatory even when old rollout flags are off",async()=>{
  vi.stubEnv("KERNEL_RETRIEVAL_REQUEST_ACCOUNTING_ENABLED","0");vi.stubEnv("KERNEL_AI_PRODUCT_QUOTA_ENABLED","0");const f=fixture();
  await expect(f.call()).rejects.toThrow("retrieval_accounting_owner_required");expect(f.fetch).not.toHaveBeenCalled();
  await f.call(ref);
  const body=JSON.parse(f.fetch.mock.calls[0]![1]!.body as string);expect(body.accounting).toEqual(ref);
  expect(Object.keys(body.accounting).sort()).toEqual(["attemptId","leaseEpoch","orgId","runId"]);
  expect(JSON.stringify(body)).not.toContain("private-service-key");
 });
 it("missing or invalid trusted ownership prevents service HTTP",async()=>{
  const f=fixture();await expect(f.call()).rejects.toThrow("retrieval_accounting_owner_required");
  await expect(f.call({...ref,leaseEpoch:0})).rejects.toThrow();
  await expect(f.call({...ref,userId:"cannot-assert"} as never)).rejects.toThrow();expect(f.fetch).not.toHaveBeenCalled();
 });
 it("private contracts reject asserted requester, provider, URL or credentials",()=>{
  const payload=kind==="embedding"?{texts:["query"]}:{query:"query",candidates:[{id:"a",content:"evidence"}]};
  const schema=kind==="embedding"?RetrievalEmbeddingRequest:RetrievalRerankRequest;
  expect(schema.safeParse({...payload,accounting:ref}).success).toBe(true);
  for(const extra of [{userId:"x"},{modelProvider:"x"},{baseUrl:"https://x"},{key:"x"}])expect(schema.safeParse({...payload,accounting:{...ref,...extra}}).success).toBe(false);
 });
});
