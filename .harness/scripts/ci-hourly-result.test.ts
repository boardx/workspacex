import {expect,it} from 'vitest';
import {requireHourlyResults} from './ci-hourly-result.mjs';
const sha='a'.repeat(40),expected=['freeze-source','e2e-full','backend-full','board-full','skill-full','billing-full'];
const good=()=>Object.fromEntries(expected.map(name=>[name,{result:'success',outputs:name==='freeze-source'?{sha}:{}}]));
it('certifies only the exact complete same-SHA full producer set',()=>{
 expect(requireHourlyResults(good(),{expected,sha})).toEqual({mode:'full',verifiedSha:sha,fullRegression:true,coverage:'frozen-develop-snapshot-not-every-commit'});
 for(const name of expected)for(const result of ['failure','skipped','cancelled',undefined])expect(()=>requireHourlyResults({...good(),[name]:{result}},{expected,sha})).toThrow();
 for(const value of [{},{...good(),other:{result:'success'}},Object.fromEntries(Object.entries(good()).slice(1)),{...good(),'freeze-source':{result:'success',outputs:{sha:'b'.repeat(40)}}}])expect(()=>requireHourlyResults(value,{expected,sha})).toThrow();
});

import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {parse} from 'yaml';
it('actual CLI retains a failed fullRegression=false receipt for skipped producers, never a successful full receipt',()=>{
 const dir=mkdtempSync(join(tmpdir(),'hourly-full-receipt-'));
 try{
  const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),members=parse(readFileSync('.github/workflows/harness-acceptance.yml','utf8')).jobs['hourly-full-result'].needs;
  const needs=Object.fromEntries(members.map((name:string)=>[name,{result:name==='backend-full'?'skipped':'success',outputs:name==='freeze-source'?{sha:head,frozen_at:'2026-11-07T00:00:00Z'}:{}}]));
  const result=spawnSync(process.execPath,['.harness/scripts/ci-hourly-result.mjs'],{encoding:'utf8',env:{...process.env,GITHUB_EVENT_NAME:'schedule',GITHUB_REPOSITORY:'boardx/workspacex',GITHUB_REF:'refs/heads/develop',GITHUB_SHA:head,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',RUNNER_TEMP:dir,CI_FULL_NEEDS:JSON.stringify(needs),GITHUB_STEP_SUMMARY:undefined}});
  expect(result.status).toBe(1);const receipt=JSON.parse(readFileSync(join(dir,'hourly-full/receipt.json'),'utf8'));expect(receipt).toMatchObject({fullRegression:false,verifiedSha:null,eventSha:head,producerResults:{'backend-full':'skipped'},sourceFrozenAt:'2026-11-07T00:00:00Z'});
 }finally{rmSync(dir,{recursive:true,force:true});}
});
