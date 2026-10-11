import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PgDatabase} from '../src/infrastructure/db/pg-database';
import {appConfig} from '../src/infrastructure/db/pg-config';
import {toOrgId} from '../src/domain/org-id';
import {PersistedResearchRuntimeSchema} from '../src/application/research/guided-runtime-persistence';
const dir=process.env.RESEARCH_5546_EVIDENCE_DIR??'/tmp/research-5546-full-20261010';
async function main(){
 const meta=JSON.parse(readFileSync(`${dir}/candidate-stack.json`,'utf8'));
 if(!meta.database.startsWith('wsx_')||meta.composeProject!=='wsx-'+meta.database.slice(4))throw new Error('Owned candidate isolation mismatch');
 const db=new PgDatabase({...appConfig(),port:meta.pgPort,database:meta.database,host:'127.0.0.1'});
 try{await db.withTenant(toOrgId(meta.orgId),async tx=>{
  const row=await tx.query<{state:unknown}>('SELECT state FROM guided_research_runtime WHERE org_id=$1 AND session_id=$2',[meta.orgId,meta.sessionId]);
  const state=PersistedResearchRuntimeSchema.parse(row.rows[0]?.state);
  if(process.argv[2]==='annotate'){
   if(state.busy||state.modelCalls.length)throw new Error('Refusing fixture mutation after execution begins');
   const observations=JSON.parse(readFileSync(`${dir}/source-observations.json`,'utf8'));
   const failures=observations.filter((o:any)=>o.reason);
   state.activity=failures.map((o:any,index:number)=>({executionVersion:state.version,id:`source-read-${o.id}`,sequence:index,stage:'reading',taskId:state.sources.find(s=>s.id===o.id)?.taskId??null,summary:`完整复现来源读取失败：${state.sources.find(s=>s.id===o.id)?.title??o.id}（${o.reason}）`,occurredAt:new Date().toISOString(),status:'failed'}));
   for(const source of state.sources){const reason=observations.find((o:any)=>o.id===source.id)?.reason;if(reason)source.documentError=reason.includes('BLOCKED')?'blocked':reason.includes('UNSUPPORTED')?'unsupported':'unavailable';}
   await tx.query('UPDATE guided_research_runtime SET state=$3::jsonb WHERE org_id=$1 AND session_id=$2',[meta.orgId,meta.sessionId,JSON.stringify(PersistedResearchRuntimeSchema.parse(state))]);
   console.log(JSON.stringify({event:'fixture_read_failures_persisted',failures:failures.length}));
  }
  const hash=(value:unknown)=>value?createHash("sha256").update(JSON.stringify(value)).digest("hex"):null;
  const observation={completed:state.completed,reportPartial:state.reportPartial??false,reportHash:hash(state.report),previousReportHash:hash(state.reportPrevious?.report),draftHash:hash(state.reportDraft),outlineHash:hash(state.outline),sessionId:meta.sessionId,version:state.version,busy:state.busy,errorCode:state.errorCode,progress:state.progress,modelCalls:state.modelCalls.length,formalChapters:state.report?.sections.length??0,draftChapters:state.reportDraft?.sections.length??0,qualityWarnings:state.reportQualityWarnings,evidenceWarnings:state.reportEvidenceWarnings?.map(w=>({reason:w.reason,batchIndex:w.batchIndex,sources:w.sourceIds.length})),sources:state.sources.length,documents:state.sources.filter(s=>s.document).length,activityFailures:state.activity?.filter(e=>e.status==='failed').length,timeline:state.reportTimeline?.map(t=>({id:t.id,status:t.status,attempts:t.attempts}))};
  console.log(JSON.stringify(observation));
  const snapshot=process.argv[2];if(snapshot&&snapshot!=='annotate'){
   if(!['first','regenerate'].includes(snapshot)||state.busy)throw new Error('Independent completed snapshot required');
   const path=`${dir}/${snapshot}-db-runtime.json`;if(existsSync(path))throw new Error('Refusing independent snapshot overwrite');
   writeFileSync(path,JSON.stringify(state),{mode:0o600});writeFileSync(`${dir}/${snapshot}-db-result.json`,JSON.stringify(observation,null,2),{mode:0o600});
  }
 });}finally{await db.close();}
}
main().catch((e:any)=>{console.log(JSON.stringify({event:'candidate_observation_failed',type:e.name,code:e.code??e.reasonCode,message:e.message?.slice(0,150)}));process.exitCode=1;});
