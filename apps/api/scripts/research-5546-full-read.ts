import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { GoogleGuidedSearch } from '../src/infrastructure/research/google-guided-search';
import { sourceRelevanceBasis } from '../src/application/research/guided-source-relevance';
import type { ResearchRuntime } from '../src/application/research/guided-runtime-ports';
import { PersistedResearchRuntimeSchema } from '../src/application/research/guided-runtime-persistence';
const dir='/tmp/research-5546-full-20261010';
async function main(){
 if(existsSync(`${dir}/input-runtime.json`))throw new Error('Refusing to overwrite existing independent fixture');
 mkdirSync(dir,{recursive:true,mode:0o700});
 const meta=JSON.parse(readFileSync(new URL('../../../docs/evidence/research-organizing-5546/original-source-metadata.json',import.meta.url),'utf8'));
 const plan=JSON.parse(readFileSync(new URL('../../../docs/evidence/research-organizing-5546/original-plan-metadata.json',import.meta.url),'utf8'));
 const prior=JSON.parse(readFileSync('/tmp/research-5546-not-configured-probe-runtime.json','utf8'));
 const reader=new GoogleGuidedSearch();
 const sources:ResearchRuntime['sources']=new Array(meta.length);const observations:any[]=new Array(meta.length);
 let cursor=0;
 await Promise.all(Array.from({length:4},async()=>{
  while(cursor<meta.length){const i=cursor++;const [id,url,title,taskIndexes,originalHash,_length,_truncated,basis]=meta[i];
   const source:ResearchRuntime['sources'][number]={id,url,title,taskId:plan.tasks[taskIndexes[0]].id,taskIds:taskIndexes.map((n:number)=>plan.tasks[n].id),content:'Original search excerpt unavailable; report uses independently retrieved document.',decision:'accepted',retrievedAt:new Date().toISOString()};
   const old=prior.sources.find((s:any)=>s.id===id&&s.document);
   try{
    const document=old?.document??await reader.read(url);const hash=createHash('sha256').update(document.text).digest('hex');
    source.content=document.text.slice(0,200);
    // Original Seattle was excerpt-only; new public retrieval is a new source version.
    source.document={url,...document,contentHash:hash,summary:document.text.slice(0,200),retrievedAt:new Date().toISOString()};
    observations[i]={id,material:old?'existing-private-reread':'new-public-read',hash,originalHash,identical:hash===originalHash,length:document.text.length,basis,approvalReused:false};
   }catch(error:any){source.documentError='unavailable';observations[i]={id,material:'new-public-read',reason:error.reasonCode??'document-unavailable',originalHash,basis,approvalReused:false};}
   sources[i]=source;console.log(JSON.stringify({event:'source_prepared',...observations[i]}));
  }
 }));
 const state:ResearchRuntime={sessionId:'research-5546-full',version:1,revision:1,currentNode:'report',availableNodes:['report'],...plan,directions:[],sources,reportPartial:false,report:null,completed:false,busy:false,leaseUntil:null,errorCode:null,generatedNodes:[],messages:[],proposal:null,modelCalls:[]};
 for(let i=0;i<sources.length;i++){
  const source=sources[i]!;const obs=observations[i];
  const actual=sourceRelevanceBasis(state,source);
  obs.actualBasis=actual;
  if(obs.identical&&actual===obs.basis){source.relevanceBasis=obs.basis;obs.approvalReused=true;}
 }
 const parsed=PersistedResearchRuntimeSchema.parse(state);
 writeFileSync(`${dir}/input-runtime.json`,JSON.stringify(parsed),{mode:0o600});
 writeFileSync(`${dir}/source-observations.json`,JSON.stringify(observations,null,2),{mode:0o600});
 console.log(JSON.stringify({event:'fixture_ready',sources:sources.length,documents:sources.filter(s=>s.document).length,approvalsReused:observations.filter(o=>o.approvalReused).length,changedOrUnavailable:observations.filter(o=>!o.approvalReused).length,questions:state.outline.reduce((sum,s)=>sum+s.questions.length+(s.subsections??[]).reduce((a,b)=>a+b.questions.length,0),0),reportPartial:state.reportPartial,planRevisionPresent:Object.hasOwn(parsed,'planRevision')}));
}
main().catch((e:any)=>{console.log(JSON.stringify({event:'fixture_failed',type:e.name,issues:e.issues?.map((x:any)=>({code:x.code,path:x.path}))}));process.exitCode=1;});
