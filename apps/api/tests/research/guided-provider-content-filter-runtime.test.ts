import {createServer} from "node:http";
import type {AddressInfo} from "node:net";
import {expect,it} from "vitest";
import {ConfiguredModelProvider} from "../../src/infrastructure/agent-run/configured-model-provider";
import {GuidedRuntimeService} from "../../src/application/research/guided-runtime-service";
import type {ResearchRuntime,RuntimeActor,GuidedRuntimeStore} from "../../src/application/research/guided-runtime-ports";
import {prepareGeometry} from "./full-source-geometry-fixture";
const section = (id: string, title: string, order: number, enabled = true) => ({ id, title, order, enabled, questions: [`What does ${id} establish?`] });
const body = (id: string) => `### Evidence\n\nThe source describes a limited policy requirement, supporting this comparison while leaving implementation uncertain. [[source:${id}]]\n\n### Decision implications\n\nThe requirement may affect entry timing and verification effort; this is an inference, not proof of profitability.\n\n### Recommended next steps\n\nVerify the unanswered implementation questions with local primary sources before making an irreversible investment decision.`;
function fixture() {
  const state: ResearchRuntime = { sessionId: "s", version: 4, revision: 1, currentNode: "report", availableNodes: ["report"],
    brief: { topic: "Policy", goal: "Compare", timeRange: "2026", region: "EU", focus: "Grid" }, directions: [],
    outline: [section("b", "Second specified title", 0), section("disabled", "Excluded", 1, false), section("a", "First specified title", 2)],
    tasks: ["a", "b"].map((id) => ({ id: `task-${id}`, sectionId: id, query: `${id} policy`, status: "succeeded", attempts: 1, errorCode: null })),
    sources: ["a", "b"].map((id) => ({ id: `source-${id}`, taskId: `task-${id}`, title: id, content: `Evidence for ${id}`, url: `https://example.com/${id}`, retrievedAt: "2026-09-07", decision: "accepted" })), report: null,
    completed: false, busy: true, leaseUntil: null, errorCode: null, generatedNodes: [], messages: [], proposal: null, modelCalls: [] };
  const writes: ResearchRuntime[] = [];
  return { state, writes };
}
function answer(context: any) {
  if (context.reportStage === "evidence" || context.researchStage === "source_relevance") return { evaluations: context.chunks.map((chunk: any) => {
    const matches = context.questions.filter((question: any) => context.researchStage === "source_relevance" ? chunk.questionIds.includes(question.id) : chunk.sourceId.endsWith(question.sectionId) || !context.chunks.some((candidate: any) => candidate.sourceId.endsWith(question.sectionId)))
      .map((question: any) => ({ questionId: question.id, quote: (chunk.content ?? chunk.quoteOptions[0].text).slice(0, 80), insight: "The excerpt supports a limited policy comparison.", relevance: "direct" }));
    return { sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: !matches.length, matches };
  }) };
  if (context.reportStage === "quality") return { questions: context.evidenceByQuestion.map((question: any) => ({ questionId: question.id, status: question.gap ? "gap" : "answered", rationale: "The chapter addresses this question with appropriate limitations." })), supported: true, analysisDepth: "adequate", issues: [] };
  if (context.chapterOutputMode === "question_paragraphs") return { sectionId: context.section.id, paragraphs: context.questionCoveragePlan.map((question: any) => {
    const sourceIds = [...new Set<string>(question.evidenceScope.map((entry: any) => entry.sourceId))];
    return { questionId: question.questionId, body: `The verified policy evidence supplies a limited comparison for this question. Its requested measurement remains uncertain; the local data owner must measure the outcome before making the corresponding investment decision. ${sourceIds.map(id => `[[source:${id}]]`).join(" ")}` };
  }) };
  if (["chapter", "chapter_revision"].includes(context.reportStage)) return { sectionId: context.section.id, body: body(context.sources[0].id), sourceIds: [context.sources[0].id] };
  return { introduction: "This study compares policy requirements using retrieved excerpts, with incomplete implementation coverage.", conclusion: "Prioritize local verification before investment, balancing entry speed against uncertain regulatory obligations.", title: "Evidence-based findings", summary: `The chapters support a cautious comparison. [[source:${context.chapters[0].sourceIds[0]}]]` };
}


// Fixed semantic verdicts and clone storage test refusal isolation/save calls,
// not real-model quality or database durability. All HTTP stays on loopback.
it.each([false,true].flatMap(regenerated => ["filter", "400", "401", "stop-empty", "unknown-empty"].map(responseKind => ({regenerated,responseKind}))))("handles $responseKind on first/regenerated report ($regenerated)",async ({regenerated,responseKind})=>{
 const f=fixture();prepareGeometry(f.state);const batches:number[]=[];const requestKeys:string[]=[];const refusedBatchIndex=15;
 const previous={title:"Previous report",summary:"Saved",sections:f.state.outline.map(s=>({sectionId:s.id,body:body(f.state.sources[0]!.id),sourceIds:[f.state.sources[0]!.id]}))};
 if(regenerated)f.state.report=previous;
 const server=createServer((request,response)=>{
  let raw="";request.on("data",chunk=>{raw+=chunk;});request.on("end",()=>{
   try{const wire=JSON.parse(raw);const context=JSON.parse(wire.messages.find((m:{role:string})=>m.role==="user").content);
    response.writeHead(context.reportStage==="evidence" && context.batchIndex===refusedBatchIndex && ["400","401"].includes(responseKind) ? Number(responseKind) : 200,{"content-type":"application/json"});
    if(context.reportStage==="evidence"){batches.push(context.batchIndex);requestKeys.push(JSON.stringify([context.batchIndex,context.questions.map((q:any)=>q.id)]));}
    if(context.reportStage==="evidence"&&context.batchIndex===refusedBatchIndex){
     const refusal=responseKind==="filter" ? {choices:[{message:{content:null},finish_reason:"content_filter"}],usage:{prompt_tokens:12,completion_tokens:0}} : ["400","401"].includes(responseKind) ? {error:{code:"invalid_parameter"}} : {choices:[{message:{content:null},finish_reason:responseKind==="stop-empty" ? "stop" : "unknown_filter"}]};
     response.end(JSON.stringify(refusal));return;
    }
    response.end(JSON.stringify({choices:[{message:{content:JSON.stringify(answer(context))},finish_reason:"stop"}],usage:{prompt_tokens:1,completion_tokens:1}}));
   }catch{response.end(JSON.stringify({error:{code:"invalid_test_request"}}));}
  });
 });
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 try{
  const provider=new ConfiguredModelProvider({provider:"test",baseUrl:`http://127.0.0.1:${(server.address() as AddressInfo).port}`,apiKey:"test-only",timeoutMs:5000,streamEnabled:false,visionModelIds:new Set(),thinkingDisableModelIds:new Set(),bailianExtensionsEnabled:false});
  const store:GuidedRuntimeStore={read:async()=>f.state,claim:async()=>({state:f.state,replay:false}),write:async(_actor,_request,state)=>{f.writes.push(structuredClone(state));}};
  const service=new GuidedRuntimeService(store,provider,{search:async()=>[]},{provider:"test",id:"model"});
  const result=await service.execute({sessionId:"s",userId:"u",orgId:"org"} as RuntimeActor,{sessionId:"s",brief:f.state.brief,directions:{versions:[]},outline:{versions:[]},sourceCount:0,status:"draft",resumeStage:"brief"} as any,
   {sessionId:"s",requestId:"content-filter",node:"report",expectedVersion:4,...(regenerated?{action:"message" as const,message:"重新生成报告"}:{action:"generate" as const})});
  if(responseKind!=="filter") {
    expect(result.errorCode).toBe("RESEARCH_WORKFLOW_UNAVAILABLE");
    expect(result.report).toBeNull();
    expect(result.reportEvidenceWarnings??[]).toEqual([]);
    expect(batches.filter(i=>i===refusedBatchIndex)).toHaveLength(1);
    expect(new Set(requestKeys).size).toBe(requestKeys.length);
    if(regenerated)expect(result.reportPrevious?.report).toEqual(previous);
    return;
  }
  expect(result.errorCode).toBeNull();
  expect(result.busy).toBe(false);
  expect(result.report?.sections).toHaveLength(4);
  expect(result.reportDraft??null).toBeNull();
  expect(result.reportQualityWarnings??[]).toEqual([]);
  expect(new Set(result.questionEvidence?.map(q=>q.questionId)).size).toBe(32);
  expect(f.writes.at(-1)?.report).toEqual(result.report);
  expect(batches).toHaveLength(23); // Source-heavy extraction stays shared across all four chapters.
  expect(batches.filter(i=>i===refusedBatchIndex)).toHaveLength(1);
    expect(new Set(requestKeys).size).toBe(requestKeys.length);
  expect(result.reportEvidenceWarnings?.find(w=>w.batchIndex===refusedBatchIndex)?.reason).toBe("batch_provider_content_rejected");
  if(regenerated)expect(result.reportPrevious?.report).toEqual(previous);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
}, 15000);
