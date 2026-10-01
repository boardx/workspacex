import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateJourneyArtifact} from './board-journey-policy.mjs';
const sha='a'.repeat(40);
test('journeys reject missing, duplicate, failed and fixture-only evidence without awarding model coverage',async()=>{
 for(const reports of [[],Array.from({length:6},()=>({title:'Brainstorm:',testId:'same',status:'passed',observations:[]}))]){
 const result=await validateJourneyArtifact({version:1,kind:'board-journey-bundle',reports},sha,{});
 assert.equal(result.valid,false);assert.equal(result.score,null);assert.ok(result.pending.some(p=>p.includes('real-model')));
 }
});
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
test('UNIT synthetic schema accepts bounded evidence but never real model coverage; tampering is rejected',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'journey-unit-'));
 try{
 const bytes=JSON.stringify({traceEvents:[{name:'unit-only'}]}),path=join(dir,'trace.json');await writeFile(path,bytes);
 const trace={path,sha256:createHash('sha256').update(bytes).digest('hex')};
 const context={runtimeMarker:'unit',startedAt:'2026-09-27T00:00:00Z',endedAt:'2026-09-27T00:40:00Z'};
 const runtimeIdentity={sha,buildSha:sha,dirty:false,method:'fresh-server-marker-and-built-chunk-hashes',deploymentMarker:'unit',buildId:'unit',runStartedAt:context.startedAt,buildCreatedAt:'2026-09-27T00:01:00Z',chunks:[{url:'/unit.js',sha256:'b'.repeat(64),localSha256:'b'.repeat(64)}]};
 const metrics=[['ttfi-ms',5000],['ten-stickies-ms',30000],['organize-actions-after-selection',2],['connection-clicks-per-edge',2],['screenshot-paste-actions',1],['prepared-proposal-confirm-actions',2]];
 const reports=['Brainstorm:','Organize:','Panel:','Diagram:','Visual Research:','AI Ready API:'].map((title,index)=>{
 const objects=Array.from({length:index===0?20:index===2?11:5},(_,i)=>({id:String(i),text:'unit',geometry:{x:i,y:0,width:10,height:10,rotation:0},parentId:index===2&&i>0?'0':''}));
 return{version:1,kind:'board-journey',sha,title,testId:String(index),retry:0,status:'passed',errors:[],runtimeIdentity,trace,approved:false,score:null,modelOrganizeVerified:false,observations:[{name:'canonical-reload-result',value:{boardId:'unit',revision:{seq:1,epoch:1},objects,browserRows:objects}},...(index===5?[{name:'ai-organize-coverage-boundary',value:{unverifiedRequirements:['semantic theme inference']}}]:[])]};});
 reports[0].observations.push(...metrics.map(([name,limit])=>({name,value:{name,limit,observed:1}})));
 const artifact={version:1,kind:'board-journey-bundle',reports};
 const valid=await validateJourneyArtifact(artifact,sha,context);assert.deepEqual(valid.failures,[]);assert.ok(valid.pending.length);assert.equal(valid.score,null);
 for(const mutate of [r=>r[0].runtimeIdentity={...runtimeIdentity,deploymentMarker:'stale'},r=>r[1].testId='0',r=>r[5].modelOrganizeVerified=true,r=>r[0].observations[1].value.observed=5000,r=>r[0].trace={...trace,sha256:'0'.repeat(64)}]){const altered=structuredClone(reports);mutate(altered);assert.equal((await validateJourneyArtifact({...artifact,reports:altered},sha,context)).valid,false);}
 }finally{await rm(dir,{recursive:true,force:true});}
});
