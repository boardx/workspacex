import {createHash} from 'node:crypto';
import {beforeEach,expect,it,vi} from 'vitest';
import {toOrgId} from '../../src/domain/org-id';
import {generateInterviewMarkdown} from '../../src/application/interview/generate-interview-markdown';
import {ModelCallError,type ModelCallInput} from '../../src/application/agent-run/ports';
import type {interviewMarkdown} from '@repo/contracts';
import type {z} from 'zod';
const read=vi.hoisted(()=>vi.fn());
vi.mock('../../src/application/interview/read-interview-markdown',()=>({readInterviewMarkdown:read}));
type Snapshot=z.infer<typeof interviewMarkdown.InterviewMarkdownEnvelope>;
const incomplete='# 未完成报告\n\n仅有访谈记录。';
let snapshot:Snapshot;
const input={orgId:toOrgId('org-thinking-policy'),interviewId:'itv-thinking-policy',viewerUserId:'actor',step:'report' as const};
beforeEach(()=>{
 const markdown='## [甲](#expert-a)\n反对电话。\n## [乙](#expert-b)\n支持电话。';
 snapshot={interviewId:input.interviewId,revisionId:'revision-policy',version:7,documents:[{documentId:'md-runs',step:'runs',version:1,markdown,contentHash:createHash('sha256').update(markdown).digest('hex'),evidenceMode:'simulated',references:[]}],states:[{documentId:'md-runs',status:'completed',failure:null}],execution:null,review:null};
 read.mockReset();read.mockImplementation(async()=>structuredClone(snapshot));
});
it.each(['initial','continue','repair'] as const)('uses direct-writing policy and caller cancellation for %s report requests',async mode=>{
 const saveDraft=vi.fn(async(value:any)=>{
  snapshot.version=value.expectedVersion+1;
  snapshot.documents=[...snapshot.documents.filter(d=>d.step!=='report'),{documentId:'md-report',step:'report',version:value.expectedDocumentVersion+1,markdown:value.markdown,contentHash:createHash('sha256').update(value.markdown).digest('hex'),evidenceMode:'simulated',references:value.references}];
  snapshot.states=[...snapshot.states.filter(s=>s.documentId!=='md-report'),{documentId:'md-report',status:value.failure?'failed':'draft',failure:value.failure??null}];
 });
 if(mode==='continue')await saveDraft({expectedVersion:7,expectedDocumentVersion:0,markdown:incomplete,references:[],failure:{code:'AI_GENERATION_UNAVAILABLE',retryable:true}});
 const before=structuredClone(snapshot.documents.filter(d=>d.step!=='report'));
 const requests:ModelCallInput[]=[];
 const completeStream=vi.fn(async(request:ModelCallInput,onDelta:(text:string)=>Promise<void>)=>{
  requests.push(request);
  if(mode==='repair'&&requests.length===1){await onDelta(incomplete);return {text:incomplete};}
  throw new ModelCallError('MODEL_CALL_FAILED','controlled provider failure');
 });
 const controller=new AbortController();
 const deps={reader:{saveDraft},model:{complete:vi.fn(),completeStream},modelProvider:'fixture',modelId:'qwen3.7-plus'} as unknown as Parameters<typeof generateInterviewMarkdown>[0];
 await expect(generateInterviewMarkdown(deps,{...input,expectedVersion:snapshot.version,expectedDocumentVersion:mode==='continue'?1:0,signal:controller.signal,onProgress:vi.fn()})).rejects.toThrow('AI_GENERATION_UNAVAILABLE');
 expect(requests).toHaveLength(mode==='repair'?2:1);
 for(const request of requests){expect(request.thinkingMode).toBe('off');expect(request.signal).toBe(controller.signal);}
 expect(snapshot.documents.filter(d=>d.step!=='report')).toEqual(before);
 if(mode==='continue'){expect(saveDraft).toHaveBeenCalledTimes(1);expect(snapshot.documents.find(d=>d.step==='report')?.markdown).toBe(incomplete);}
});
