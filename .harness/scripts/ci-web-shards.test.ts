import {it,expect} from 'vitest';
import {discoverCoverage,shardPlan,validateReport,assertCoverage} from './ci-web-shards.mjs';
it('covers actual Web ts and tsx identities exactly',async()=>{
 const result=await discoverCoverage(shardPlan({schemaVersion:1,count:4}));
 expect(result.files).toBeGreaterThan(0);
 expect(result.partitions.flat().some((row:any)=>row.file.endsWith('.tsx'))).toBe(true);
 expect(result.counts.every((count:number)=>count>0)).toBe(true);
},30000);
it('rejects missing duplicate empty and failed report identities',()=>{
 const row={file:'a.test.tsx',projectName:''};
 const report={success:true,numPassedTests:1,testResults:[{name:'/tmp/a.test.tsx',status:'passed',assertionResults:[{status:'passed'}]}]};
 expect(()=>validateReport(report,[row],'/tmp')).not.toThrow();
 expect(()=>validateReport({...report,success:false},[row],'/tmp')).toThrow();
 expect(()=>validateReport({...report,testResults:[]},[row],'/tmp')).toThrow();
 expect(()=>validateReport({...report,testResults:[...report.testResults,...report.testResults]},[row],'/tmp')).toThrow();
 expect(()=>assertCoverage([row],[[row],[]])).toThrow();
});

import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {runShard,validateShardEvidence} from './ci-web-shards.mjs';
it('runs exact real fixture shards and rejects missing, duplicate and tampered evidence',async()=>{
 const cwd=realpathSync(mkdtempSync(resolve(tmpdir(),'web-shards-')));
 try{
  writeFileSync(resolve(cwd,'vitest.config.mjs'),"export default {test:{include:['*.test.ts','*.test.tsx'],maxWorkers:1,minWorkers:1}}");
  const vitest=resolve('node_modules/vitest/dist/index.js');
  for(const name of ['a.test.ts','b.test.tsx','c.test.ts'])writeFileSync(resolve(cwd,name),`import {test,expect} from ${JSON.stringify(vitest)};test('passes',()=>expect(1).toBe(1));`);
  const plan=shardPlan({schemaVersion:1,count:2}),outputs:any[]=[];let coverage:any;
  for(const index of plan.shards){const dir=resolve(cwd,String(index));mkdirSync(dir);coverage=await runShard(plan,index,dir,cwd);outputs.push({manifest:JSON.parse(readFileSync(resolve(dir,'manifest.json'),'utf8')),report:readFileSync(resolve(dir,'report.json'),'utf8'),log:readFileSync(resolve(dir,'run.log'),'utf8')});}
  const identity={sourceSHA:outputs[0].manifest.sourceSHA,run:outputs[0].manifest.run,attempt:outputs[0].manifest.attempt};
  expect(validateShardEvidence(coverage,outputs,identity)).toBe(true);
  expect(()=>validateShardEvidence(coverage,outputs,{...identity,run:undefined})).toThrow('MISSING_RUN_IDENTITY');
  expect(()=>validateShardEvidence(coverage,outputs.slice(1),identity)).toThrow();
  expect(()=>validateShardEvidence(coverage,[outputs[0],outputs[0]],identity)).toThrow();
  for(const field of ['sourceSHA','attempt'])expect(()=>validateShardEvidence(coverage,outputs,{...identity,[field]:'bad'})).toThrow();
  for(const field of ['report','log'])expect(()=>validateShardEvidence(coverage,[{...outputs[0],[field]:outputs[0][field]+'x'},outputs[1]],identity)).toThrow();
  expect(()=>validateShardEvidence({...coverage,discoverySha256:'bad'},outputs,identity)).toThrow();
  for(const name of ['a.test.ts','b.test.tsx','c.test.ts'])writeFileSync(resolve(cwd,name),`import {test} from ${JSON.stringify(vitest)};test.skip('skip',()=>{});`);
  await expect(runShard(plan,1,resolve(cwd,'1'),cwd)).rejects.toThrow();
  writeFileSync(resolve(cwd,'a.test.ts'),`import {test} from ${JSON.stringify(vitest)};test('fails',()=>{throw Error('expected')});`);
  const failed=await discoverCoverage(plan,cwd);const index=failed.partitions.findIndex((rows:any[])=>rows.some(row=>row.file==='a.test.ts'))+1;
  await expect(runShard(plan,index,resolve(cwd,String(index)),cwd)).rejects.toThrow('SHARD_RUN_FAILED');
 }finally{rmSync(cwd,{recursive:true,force:true});}
},30000);
