import {expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {identity,stamp,verify,combineBase,requireChatProducers} from './ci-parallel-evidence.mjs';
import {assertCoverage} from './ci-api-shards.mjs';
const hash=(x:string)=>createHash('sha256').update(x).digest('hex');
const env={GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'2'};
it('rejects missing publication identity',()=>{for(const k of Object.keys(env))expect(()=>identity({...env,[k]:''})).toThrow();});
it('reads complete reports and rejects wrong source, changed evidence and missing logs',()=>{
 const d=mkdtempSync(join(tmpdir(),'parallel-evidence-'));
 try{
  const partitions=Array.from({length:4},(_,i)=>[{file:`${i}.test.ts`,projectName:''}]);
  const coverage={...assertCoverage(partitions.flat(),partitions),partitions};
  mkdirSync(join(d,'coverage'));const file=join(d,'coverage/coverage.json');writeFileSync(file,JSON.stringify(coverage));stamp(file,env);
  for(let index=1;index<=4;index++){
   const dir=join(d,String(index));mkdirSync(dir);
   const report=JSON.stringify({success:true,numPassedTests:1,testResults:[{name:`/fixture/${index-1}.test.ts`,status:'passed',assertionResults:[{status:'passed'}]}]});
   const log='Tests 1 passed';
   writeFileSync(join(dir,'report.json'),report);writeFileSync(join(dir,'run.log'),log);
   writeFileSync(join(dir,'manifest.json'),JSON.stringify({index,count:4,sourceSHA:env.GITHUB_SHA,run:env.GITHUB_RUN_ID,attempt:env.GITHUB_RUN_ATTEMPT,cwd:'/fixture',discoverySha256:coverage.discoverySha256,identities:partitions[index-1],reportSha256:hash(report),logSha256:hash(log)}));
  }
  expect(verify('web',d,env).status).toBe('verified');
  expect(()=>verify('web',d,{...env,GITHUB_SHA:'b'.repeat(40)})).toThrow();
  writeFileSync(file,JSON.stringify({...coverage,discoverySha256:'bad'}));expect(()=>verify('web',d,env)).toThrow();writeFileSync(file,JSON.stringify(coverage));
  writeFileSync(join(d,'1/run.log'),'tampered');expect(()=>verify('web',d,env)).toThrow();
  expect(()=>combineBase(d,join(d,'out'))).toThrow();
  mkdirSync(join(d,'package-evidence'));writeFileSync(join(d,'package-evidence/non-api-tests.log'),'Tests 3 passed');
  writeFileSync(join(d,'api-tests.log'),'Tests 4 passed');mkdirSync(join(d,'web-evidence'));
  for(let i=1;i<=4;i++){mkdirSync(join(d,'web-evidence',String(i)));writeFileSync(join(d,'web-evidence',String(i),'run.log'),'Tests 1 passed');}
  combineBase(d,join(d,'out'));expect(readFileSync(join(d,'out'),'utf8')).toContain('Tests 4 passed');
  writeFileSync(join(d,'api-tests.log'),'');expect(()=>combineBase(d,join(d,'out'))).toThrow('EMPTY_TEST_LOG');
 }finally{rmSync(d,{recursive:true,force:true});}
});

import {parse} from 'yaml';
import {spawnSync} from 'node:child_process';
it('accepts the actual routed chat workflow dependency payload and rejects incomplete producers',()=>{
 const job=parse(readFileSync('.github/workflows/harness-acceptance.yml','utf8')).jobs['chat-read'];
 const command=job.steps.find((x:any)=>typeof x.run==='string'&&x.run.includes(' chat-prerequisites')).run.trim().split(/\s+/);
 expect(command[0]).toBe('node');
 const needs=Object.fromEntries(job.needs.map((name:string)=>[name,{result:'success',outputs:name==='doc-smoke-scope'?{mode:'full',plan_digest:'c'.repeat(64)}:{}}]));
 const run=(payload:any)=>spawnSync(process.execPath,command.slice(1),{env:{...process.env,CI_CHAT_NEEDS:JSON.stringify(payload)},encoding:'utf8'});
 expect(run(needs).status).toBe(0);
 for(const name of job.needs){const missing={...needs};delete missing[name];expect(run(missing).status).not.toBe(0);expect(run({...needs,[name]:{result:'skipped'}}).status).not.toBe(0);}
 for(const outputs of [{mode:'targeted-ui',plan_digest:'c'.repeat(64)},{mode:'full',plan_digest:'bad'}])expect(run({...needs,'doc-smoke-scope':{result:'success',outputs}}).status).not.toBe(0);
 expect(run({...needs,unknown:{result:'success'}}).status).not.toBe(0);
});

it('retains the strict legacy two-producer prerequisite contract',()=>{
 const needs={'chat-test-plan':{result:'success'},'chat-test-shards':{result:'success'}};
 expect(requireChatProducers(needs)).toBe(true);
 expect(()=>requireChatProducers({...needs,'doc-smoke-scope':{result:'success'}})).toThrow();
 expect(()=>requireChatProducers(needs,{routed:true})).toThrow();
});
