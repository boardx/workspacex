import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { questionSets } from './questions';
import { GoogleGuidedSearch } from '../../../../apps/api/src/infrastructure/research/google-guided-search';
import { ConfiguredModelProvider, readModelProviderConfig } from '../../../../apps/api/src/infrastructure/agent-run/configured-model-provider';
import { withGuidedThinkingPolicy } from '../../../../apps/api/src/application/research/guided-thinking-policy';
import { GuidedRuntimeService } from '../../../../apps/api/src/application/research/guided-runtime-service';
import { PersistedResearchRuntimeSchema } from '../../../../apps/api/src/application/research/guided-runtime-persistence';
import type { ResearchRuntime, GuidedRuntimeStore, RuntimeActor } from '../../../../apps/api/src/application/research/guided-runtime-ports';
const extraUrls = [
 ['c46f74bc-e8e6-4b95-b839-fa29b571bc08','https://whlyj.beijing.gov.cn/zmhd/zxft/202605/t20260513_4649562.html','48063d926e90b77f3cab0004851ad48df584a35698da30de912c4b1e34801cbe'],
 ['fd56325b-ecee-4488-9475-e3a1ca748572','https://www.jlcity.gov.cn/zfxwfbh/202602/t20260210_1307417.html','e9c7216065ca9392398dafbd0003a1b0b09a4cf2d9303ad1be3070f93ea72298'],
 ['0228c160-6c16-411f-9392-04a5382f3f99','http://sociologyol.ruc.edu.cn/shxyj/fzshx/wlshx/37f23fec637a42ed81595a0c3f335151.htm','4d43043b6e9bcfef48eb3961c4e01982a1ece8086a0f035123fb97c4bc84ba84'],
 ['507e5051-2e10-4066-a553-4ae137f11b75','https://www.newslqy.com/news/302166','0add21968751cb1eda31f7bdb0aafa35e7816a648ad6aa418a6ab80f30d927c7'],
];
async function main(){
 const config=readModelProviderConfig(); if(!config.apiKey) throw new Error("Model environment must be loaded before replay; no local output overwritten"); const raw=new ConfiguredModelProvider({...config,streamEnabled:true});
 let calls=0; let rejected=0;
 const model=withGuidedThinkingPolicy({configurationIdentity:raw.configurationIdentity,
  complete:async input=>{if(calls>=60)throw new Error("bounded replay call cap");calls++;const c=JSON.parse(input.user);console.log(JSON.stringify({event:'dispatch',call:calls,stage:c.reportStage??c.researchStage,batch:c.batchIndex}));try{return await raw.complete(input);}catch(error:any){if(error.contentRejection==='content-policy')rejected++;console.log(JSON.stringify({event:'model_failed',code:error.code,disposition:error.retryDisposition,contentRejection:error.contentRejection}));throw error;}},
  completeStream:async(input,emit)=>{if(calls>=60)throw new Error("bounded replay call cap");calls++;const c=JSON.parse(input.user);console.log(JSON.stringify({event:'dispatch',call:calls,stage:c.reportStage,section:c.section?.id}));return raw.completeStream!(input,emit);}
 });
 const reader=new GoogleGuidedSearch();
 const extra=await Promise.all(extraUrls.map(async([id,url,expected])=>{try{const document=await reader.read(url!);const hash=createHash('sha256').update(document.text).digest('hex');console.log(JSON.stringify({event:'source_read',id,length:document.text.length,hash,identical:hash===expected}));return{id,url,document};}catch(error:any){console.log(JSON.stringify({event:'source_read_failed',id,code:error.reasonCode}));return null;}}));
 const docs=[...JSON.parse(readFileSync('/tmp/research-5546-documents.json','utf8')).filter(Boolean),...extra.filter(Boolean)];
 const titles=['文化与社会驱动因素：热闹氛围的根源','环境心理学：空间与感官对情绪的塑造','活动策划策略：最大化群体参与度','数字与虚拟替代方案：在线热闹感的重构'];
 const subsectionTitles=[['传统节日中的参与式元素与热闹感知','社区主导聚会与商业活动的情感连接对比','现代社交趋势下的持续性积极 engagement'],['感官刺激强度与情绪唤醒的关系','人群密度对个体与集体体验的双重影响','成功公共空间的空间设计案例研究'],['游戏化互动对社会 bonding 的影响','主题叙事在维持参与者兴趣中的作用','结构化程序与自由社交的最佳平衡'],['实时协作工具与被动观看格式的参与度对比','混合模式对覆盖面与亲密感的影响','促进自发社交互动的数字功能设计']];
 let state:ResearchRuntime={sessionId:'research-5546-local',version:1,revision:1,currentNode:'report',availableNodes:['report'],brief:{topic:'开开心心热闹',goal:'开开心心热闹',timeRange:'',region:'',focus:''},directions:[],outline:questionSets.map((questions,i)=>({id:`ch_${i+1}`,title:titles[i]!,order:i,enabled:true,questions:questions.slice(0,2),subsections:[0,1,2].map(n=>({id:`sec_${i+1}_${n+1}`,title:subsectionTitles[i]![n]!,questions:questions.slice(2+n*2,4+n*2)}))})),tasks:titles.map((title,i)=>({id:`task-${i}`,sectionId:`ch_${i+1}`,query:`开开心心热闹 ${title}`,status:'succeeded',attempts:1,errorCode:null})),sources:docs.map((d:any,i:number)=>({id:d.id,taskId:`task-${({'c46f74bc-e8e6-4b95-b839-fa29b571bc08':0,'fd56325b-ecee-4488-9475-e3a1ca748572':0,'0228c160-6c16-411f-9392-04a5382f3f99':1,'2e143b4d-fae2-40a1-be1e-e2a01b4f4116':2,'44ac9f92-0871-4a76-8cb2-d61aa2f1bc09':2,'e77af5a2-5a31-4f1a-958d-eac1470d3105':3,'507e5051-2e10-4066-a553-4ae137f11b75':2} as Record<string,number>)[d.id]}`,title:d.url,content:d.document.text.slice(0,200),url:d.url,retrievedAt:new Date().toISOString(),decision:'accepted',document:{url:d.url,...d.document,contentHash:createHash('sha256').update(d.document.text).digest('hex'),summary:d.document.text.slice(0,200),retrievedAt:new Date().toISOString()}})),reportPartial:true,report:null,completed:false,busy:false,leaseUntil:null,errorCode:null,generatedNodes:[],messages:[],proposal:null,modelCalls:[]};
 const stateFile='/tmp/research-5546-real-runtime.json';
 const save=()=>writeFileSync(stateFile,JSON.stringify(state),{mode:0o600}); save();
 const store:GuidedRuntimeStore={read:async()=>PersistedResearchRuntimeSchema.parse(JSON.parse(readFileSync(stateFile,'utf8'))),claim:async()=>({state,replay:false}),write:async(_actor,_request,next)=>{state=next;save();}};
 const service=new GuidedRuntimeService(store,model,{search:async()=>[]},{provider:config.provider,id:'qwen3.7-plus'});
 const actor={sessionId:state.sessionId,userId:'local-evidence',orgId:'local-evidence'} as RuntimeActor;
 const session={sessionId:state.sessionId,brief:state.brief,directions:{versions:[]},outline:{versions:[]},sourceCount:docs.length,status:'draft',resumeStage:'brief'} as any;
 const started=Date.now();
 for(const generation of ['first','regenerate'] as const){
  const generationStarted=Date.now(); const before=calls; const result=await service.execute(actor,session,{sessionId:state.sessionId,node:'report',requestId:`5546-${generation}`,expectedVersion:state.version,...(generation==='first'?{action:'generate' as const}:{action:'message' as const,message:'重新生成报告'})});
  const loaded=await store.read(actor);
  writeFileSync(`/tmp/research-5546-${generation}-runtime.json`,JSON.stringify(loaded),{mode:0o600});
  console.log(JSON.stringify({event:'generation_result',generation,durationMs:Date.now()-generationStarted,cumulativeDurationMs:Date.now()-started,calls:calls-before,rejected,errorCode:result.errorCode,chapters:result.report?.sections.length??0,draftChapters:result.reportDraft?.sections.length??0,qualityWarnings:result.reportQualityWarnings?.length??0,evidenceWarnings:result.reportEvidenceWarnings?.length??0,reloadedReport:JSON.stringify(loaded.report)===JSON.stringify(result.report),reloadedDraft:JSON.stringify(loaded.reportDraft)===JSON.stringify(result.reportDraft)}));
  if(!result.report || result.reportDraft || result.reportQualityWarnings?.length || !loaded.report) process.exitCode=1;
  if(result.errorCode)break;
 }
}
main().catch((error:any)=>{console.log(JSON.stringify({event:'probe_failed_before_result',type:error.name,issues:error.issues?.slice(0,10).map((issue:any)=>({code:issue.code,path:issue.path}))}));process.exitCode=1;});
