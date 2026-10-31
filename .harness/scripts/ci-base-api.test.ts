import { describe, expect, it, vi } from 'vitest';
import { assertPrerequisites, validateReport } from './ci-base-api.mjs';
const dependencies=['verify-full-compile','base-api-plan','base-api-shards','base-api-exclusive'];
const good=()=>Object.fromEntries(dependencies.map(name=>[name,{result:'success'}]));
describe('complete base API acceptance',()=>{
 it('requires all current producers',()=>expect(()=>assertPrerequisites(good(),'pull_request')).not.toThrow());
 it.each(['failure','cancelled','skipped',undefined])('rejects %s before historical reuse',result=>{
  for(const name of dependencies)expect(()=>assertPrerequisites({...good(),[name]:{result}},'pull_request')).toThrow();
 });
 it('rejects missing and unexpected prerequisites',()=>{
  expect(()=>assertPrerequisites({},'pull_request')).toThrow();
  expect(()=>assertPrerequisites({...good(),extra:{result:'success'}},'pull_request')).toThrow();
 });
 it('requires real successful files and tests',()=>{
  const report={success:true,numTotalTests:3,numPassedTests:3,testResults:[{status:'passed'},{status:'passed'}]};
  expect(()=>validateReport(report,2)).not.toThrow();
  for(const bad of [{...report,success:false},{...report,numTotalTests:0},{...report,numPassedTests:0},{...report,testResults:[]},{...report,testResults:[{status:'failed'}]}])expect(()=>validateReport(bad,2)).toThrow();
  expect(()=>validateReport(report,3)).toThrow();
 });
});

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { bundle, record } from './ci-base-api.mjs';
const digest=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
const env={GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'17',GITHUB_RUN_ATTEMPT:'2'};
function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'wsx-base-api-'));
 const parts=[[{file:'a.test.ts',projectName:''}],[{file:'b.test.ts',projectName:''}]];
 const exclusive=[{file:'exclusive.test.ts',projectName:''}];
 const coverage={schemaVersion:1,status:'discovery-coverage-verified',files:2,shards:2,counts:[1,1],partitions:parts,exclusive,discoverySha256:digest(parts.flat().map(row=>JSON.stringify(['',row.file])).sort().join('\n'))};
 const coverageDir=join(directory,'coverage');mkdirSync(coverageDir);
 const coverageText=JSON.stringify(coverage);writeFileSync(join(coverageDir,'coverage.json'),coverageText);
 writeFileSync(join(coverageDir,'identity.json'),JSON.stringify({sha:env.GITHUB_SHA,run:'17',attempt:'2',coverage:digest(coverageText)}));
 for(const [name,file] of [['shard-1','a.test.ts'],['shard-2','b.test.ts'],['exclusive','exclusive.test.ts']]){
  const folder=join(directory,name);mkdirSync(folder);
  writeFileSync(join(folder,'report.json'),JSON.stringify({success:true,numTotalTests:1,numPassedTests:1,testResults:[{name:`/home/runner/work/workspacex/workspacex/apps/api/${file}`,status:'passed'}]}));
  writeFileSync(join(folder,'test.log'),'Tests  1 passed (1)\n');record(folder,env);
 }
 return directory;
}
describe('real report/artifact assembly counterexamples',()=>{
 it('combines all exact partitions and exclusive evidence',()=>{
  const directory=fixture();try{expect(bundle(directory,{count:2,shards:[1,2]},env)).toContain('API exclusive');}finally{rmSync(directory,{recursive:true,force:true});}
 });
 it.each(['missing-last','wrong-run','wrong-attempt','wrong-sha','changed-log','changed-report','substituted-file','duplicate-file','all-skipped','missing-exclusive'])('rejects %s',kind=>{
  const directory=fixture();const folder=join(directory,'shard-2');
  try{
   if(kind==='missing-last')rmSync(folder,{recursive:true});
   if(kind==='missing-exclusive')rmSync(join(directory,'exclusive'),{recursive:true});
   if(kind.startsWith('wrong-')){const file=join(folder,'identity.json'),identity=JSON.parse(readFileSync(file,'utf8'));identity[kind.slice(6)]='other';writeFileSync(file,JSON.stringify(identity));}
   if(kind==='changed-log')writeFileSync(join(folder,'test.log'),'tampered');
   if(kind==='changed-report')writeFileSync(join(folder,'report.json'),'{}');
   if(['substituted-file','duplicate-file','all-skipped'].includes(kind)){
    const file=join(folder,'report.json'),report=JSON.parse(readFileSync(file,'utf8'));
    if(kind==='all-skipped')report.numPassedTests=0;
    else report.testResults[0].name='/home/runner/work/workspacex/workspacex/apps/api/'+(kind==='duplicate-file'?'a.test.ts':'different.test.ts');
    writeFileSync(file,JSON.stringify(report));
    // Re-sign so rejection proves actual coverage/empty execution, not a hash mismatch.
    if(kind!=='all-skipped')record(folder,env);
    else {const file=join(folder,'identity.json'),identity=JSON.parse(readFileSync(file,'utf8'));identity.report=digest(readFileSync(join(folder,'report.json')));writeFileSync(file,JSON.stringify(identity));}
   }
   expect(()=>bundle(directory,{count:2,shards:[1,2]},env)).toThrow();
  }finally{rmSync(directory,{recursive:true,force:true});}
 });
});

it('workflow preserves complete API coverage, isolation and failure verdict before reuse',()=>{
 const w=parse(readFileSync('.github/workflows/harness-acceptance.yml','utf8')),jobs=w.jobs;
 const core=jobs['full-regression-core'];
 expect(core.if).toContain('always()');
 expect(core.needs).toEqual(['base-compile',...dependencies.slice(1),'base-package-tests','base-control-plane','web-test-plan','web-test-shards']);
 const admission=core.steps.find((step:any)=>step.run?.includes('prerequisites-parallel'));
 expect(admission).toMatchObject({env:{CI_BASE_NEEDS:'${{ toJSON(needs) }}'}});
 expect(admission.if).toBeUndefined();
 expect(core.steps.some((step:any)=>step.id==='dedup')).toBe(false);
 expect(jobs['base-api-exclusive'].needs).toEqual(['base-api-plan','base-api-shards']);
 expect(jobs['base-api-shards'].strategy).toEqual({'fail-fast':true,matrix:{shard:'${{ fromJSON(needs.base-api-plan.outputs.shards) }}'}});
 for(const name of ['base-api-shards','base-api-exclusive']){
  const job=jobs[name];expect(job['continue-on-error']).toBeUndefined();
  expect(job.env.WORKSPACEX_DB.replace(/\$\{\{.*?\}\}/g,'1')).toMatch(/^[a-z0-9_]+$/);
  const run=job.steps.find((step:any)=>step.name==='Execute complete API partition').run;
  expect(run).toContain('set -o pipefail');expect(run).toContain('--reporter=json');
  expect(job.steps.find((step:any)=>step.name==='Retain API execution evidence').if).toBe('always()');
  expect(job.steps.find((step:any)=>step.name==='Release isolated PostgreSQL').if).toBe('always()');
  expect(job.steps.some((step:any)=>step.run==='uv sync --frozen --extra dev')).toBe(true);
 }
 const scripts=JSON.parse(readFileSync('package.json','utf8')).scripts;
 expect(scripts['verify:ci-base:raw']).not.toContain('--filter');
 expect(scripts['verify:ci-base-other:raw']).toContain("--filter='!@repo/api'");
 expect(core.steps.find((step:any)=>step.name==='Retain complete base evidence').run).toContain('ci-parallel-evidence.mjs combine-base');
 expect(core.steps.findIndex((step:any)=>step.run?.includes('prerequisites-parallel'))).toBeLessThan(core.steps.findIndex((step:any)=>step.run?.includes('combine-base')));
});

import { selectProducerArtifacts } from './ci-base-api.mjs';
it('partial reruns retain each successful producer attempt without mixing runs or future attempts',()=>{
 const artifact=(part:string,attempt:number)=>({id:attempt,name:`base-api-${part}-17-${attempt}`,expired:false});
 const artifacts=[artifact('coverage',1),artifact('shard-1',1),artifact('shard-2',1),artifact('shard-2',2),artifact('exclusive',1),artifact('coverage',3)];
 expect(selectProducerArtifacts(artifacts,{count:2,shards:[1,2]},{...env,GITHUB_RUN_ATTEMPT:'2'}).map((row:any)=>[row.part,row.attempt])).toEqual([['coverage','1'],['shard-1','1'],['shard-2','2'],['exclusive','1']]);
 expect(()=>selectProducerArtifacts(artifacts.filter(a=>!a.name.includes('exclusive')),{count:2,shards:[1,2]},env)).toThrow();
 expect(()=>selectProducerArtifacts(artifacts.map(a=>({...a,expired:true})),{count:2,shards:[1,2]},env)).toThrow();
});
it('verifies independently retained attempts and rejects an unproven producer identity',()=>{
 const directory=fixture();try{
  const attempts={coverage:'2','shard-1':'2','shard-2':'2',exclusive:'2'};
  expect(bundle(directory,{count:2,shards:[1,2]},{...env,GITHUB_RUN_ATTEMPT:'3'},attempts)).toContain('API exclusive');
  expect(()=>bundle(directory,{count:2,shards:[1,2]},{...env,GITHUB_RUN_ATTEMPT:'3'},{...attempts,'shard-2':'1'})).toThrow();
  expect(()=>bundle(directory,{count:2,shards:[1,2]},env,{...attempts,'shard-2':'3'})).toThrow();
 }finally{rmSync(directory,{recursive:true,force:true});}
});

it.each(['merge_group','workflow_dispatch'])('requires a successful selected compilation proof on %s',event=>{
 const needs={...Object.fromEntries(dependencies.slice(1).map(k=>[k,{result:'success'}])),'base-compile':{result:'success'}};
 expect(()=>assertPrerequisites(needs,event)).not.toThrow();
 for(const result of ['failure','cancelled','skipped',undefined])expect(()=>assertPrerequisites({...needs,'base-compile':{result}},event)).toThrow();
 expect(()=>assertPrerequisites({...needs,extra:{result:'success'}},event)).toThrow();
});

it.each(['merge_group','workflow_dispatch'])('inherits actual %s context and rejects old producer topology',event=>{
 vi.stubEnv('GITHUB_EVENT_NAME',event);
 try{
  const needs=Object.fromEntries(['base-compile','base-api-plan','base-api-shards','base-api-exclusive'].map(name=>[name,{result:'success'}]));
  expect(()=>assertPrerequisites(needs)).not.toThrow();
  expect(()=>assertPrerequisites(good())).toThrow('INCOMPLETE_BASE_PREREQUISITES');
 }finally{vi.unstubAllEnvs();}
});
