/** Real-model comparison using fixed MIT-licensed official code excerpts.
 * From root: WORKSPACEX_ENV_FILE=/authorized/path pnpm --filter @repo/api exec tsx ../../docs/evidence/research-report-pipeline-5848/real-model-comparison.mts
 * Add --check for configuration/material loading only, no model request.
 * No production state/DB/browser writes; only aggregate metrics are retained.
 */
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConfiguredModelProvider, readModelProviderConfig } from '../../../apps/api/src/infrastructure/agent-run/configured-model-provider';
import { withGuidedThinkingPolicy } from '../../../apps/api/src/application/research/guided-thinking-policy';
import { generateReportChapters } from '../../../apps/api/src/application/research/guided-report-chapters';
import type { ResearchRuntime } from '../../../apps/api/src/application/research/guided-runtime-ports';
import type { RuntimePersistence } from '../../../apps/api/src/application/research/guided-report-stream';
import type { ModelCallInput, ModelCallPort } from '../../../apps/api/src/application/agent-run/ports';
const root=resolve('../..');const dir=resolve(root,'docs/evidence/research-report-pipeline-5848');
if(!process.env.WORKSPACEX_ENV_FILE)throw new Error('WORKSPACEX_ENV_FILE must point to an authorized local model configuration');
const env=parseEnv(await readFile(process.env.WORKSPACEX_ENV_FILE,'utf8'));
const config=readModelProviderConfig(env); const modelId=env.KERNEL_DEFAULT_AGENT_MODEL_ID;
if(!config.apiKey||!config.provider||!config.baseUrl||!modelId)throw new Error('Missing explicit model configuration');
const delegate=withGuidedThinkingPolicy(new ConfiguredModelProvider(config));const identity=randomUUID();
const materials=JSON.parse(await readFile(resolve(dir,'real-model-materials.json'),'utf8')) as Array<{id:string;title:string;taskId:string;url:string;text:string}>;
const outline=[{id:'concurrency',title:'有界并发的实现与边界',questions:['这些官方源码摘录如何限制并发研究任务，超过上限的请求如何处理？']},{id:'synthesis',title:'压缩研究与最终报告生成',questions:['这些源码摘录如何组织研究压缩与最终报告，哪些速度和质量效果尚不能从代码直接确定？']}].map((s,order)=>({...s,order,enabled:true}));
const fixture=()=>({sessionId:'real-comparison',version:1,revision:1,currentNode:'report',availableNodes:['report'],brief:{topic:'LangChain Open Deep Research的并发与报告设计',goal:'依据官方源码比较机制与明确未知边界',region:'开源实现',timeRange:'2026-10-20抓取的当前源码摘录',focus:'并发限制、压缩与综合，不推断未测性能'},directions:[],outline:structuredClone(outline),tasks:outline.map(s=>({id:'task-'+s.id,sectionId:s.id,query:s.questions[0],status:'succeeded',attempts:1,errorCode:null})),sources:materials.map(m=>({id:m.id,taskId:m.taskId,title:m.title,url:m.url,content:m.text,retrievedAt:'2026-10-20',decision:'accepted',document:{url:m.url,text:m.text,contentHash:createHash('sha256').update(m.text).digest('hex'),retrievedAt:'2026-10-20',contentKind:'text',truncated:true,summary:'Explicit official source code excerpts; not full source files.'}})),report:null,completed:false,busy:true,leaseUntil:null,errorCode:null,generatedNodes:[],messages:[],proposal:null,modelCalls:[]}) as ResearchRuntime;
if(process.argv.includes('--check')){console.log(JSON.stringify({valid:true,provider:config.provider,model:modelId,sourceCount:materials.length}));process.exit(0);}
const results:any[]=[];const oldFile=resolve('src/application/research/guided-report-chapters-real-comparison-'+process.pid+'.ts');
async function sample(label:string,generate:typeof generateReportChapters,state=fixture()){
 const started=performance.now();let firstProse:number|undefined,firstApproved:number|undefined,calls=0,initialEvidenceCalls=0,evidenceRepairCalls=0,inputCharacters=0,tokens=0,active=0,peak=0;const events:any[]=[];
 const run=async(input:ModelCallInput,emit?: (delta:string)=>Promise<void>)=>{calls++;active++;peak=Math.max(peak,active);inputCharacters+=input.system.length+input.user.length;const stage=JSON.parse(input.user).reportStage;if(stage==='evidence')initialEvidenceCalls++;if(stage==='evidence_revision')evidenceRepairCalls++;
 try{const r=emit&&delegate.completeStream?await delegate.completeStream(input,async(delta)=>{await emit(delta);if(stage==='chapter'&&delta.trim())firstProse??=performance.now()-started;}):await delegate.complete(input);tokens+=r.tokens??0;return r;}finally{active--;}};
 const model:ModelCallPort={configurationIdentity:identity,complete:i=>run(i),...(delegate.completeStream?{completeStream:(i,e)=>run(i,e)}:{})};
 const persist:RuntimePersistence=Object.assign(async()=>{if(state.reportCheckpoint?.chapters.length)firstApproved??=performance.now()-started;},{requestId:randomUUID(),observe:()=>{}});
 let result:any;
 try{const report=await generate(state,model,{provider:config.provider,id:modelId},persist,undefined,false,undefined,event=>{events.push(event);if(event.stage==='first_prose')firstProse=event.durationMs;console.log(JSON.stringify({label,stage:event.stage,durationMs:Math.round(event.durationMs),failed:event.failed}));});result={passed:true,chapters:report.sections.length,qualityWarnings:state.reportQualityWarnings?.length??0};}
 catch(e){result={passed:false,reasonCode:(e as any)?.reasonCode??'UNCLASSIFIED_FAILURE'};}
 const record={label,...result,...(label==='baseline'?{firstProviderDeltaMs:firstProse}:{firstProseMs:firstProse}),firstApprovedMs:firstApproved,totalMs:performance.now()-started,calls,initialEvidenceCalls,evidenceRepairCalls,inputCharacters,reportedTokens:tokens,peak,events};results.push(record);
 await writeFile(resolve(dir,'real-model-results.json'),JSON.stringify({realModel:true,production:false,model:modelId,provider:config.provider,sourceCount:materials.length,materials:materials.map(({text,...m})=>({...m,characters:text.length,sha256:createHash('sha256').update(text).digest('hex')})),note:'Fixed official source excerpts, two chapters; not screenshot43-source job. Single sequential observation; provider output is nondeterministic. Baseline first stream marker may include JSON envelope; current first_prose uses prose parser.',results},null,2));
 console.log(JSON.stringify({...record,events:undefined}));return state;
}
try{await writeFile(oldFile,execFileSync('git',['show','305c629c4:apps/api/src/application/research/guided-report-chapters.ts'],{encoding:'utf8'}),{flag:'wx'});const old=(await import(pathToFileURL(oldFile).href)).generateReportChapters as typeof generateReportChapters;await sample('baseline',old);const cold=await sample('current cold',generateReportChapters);if(results.at(-1)?.passed)await sample('current matching evidence',generateReportChapters,cold);if(results.some(r=>!r.passed))process.exitCode=1;}finally{await unlink(oldFile).catch(()=>{});}
