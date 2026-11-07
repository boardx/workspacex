import {readFileSync} from 'node:fs';
import {parse} from 'yaml';
import {expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';
const w=parse(readFileSync('.github/workflows/backend-gates.yml','utf8'));
it('retains real core-loop in full regression while merge admission is explicitly lightweight',()=>{
 const h=parse(readFileSync('.github/workflows/harness-acceptance.yml','utf8'));
 expect(w.jobs['backend-full-result'].needs).toContain('e2e-core-loop');expect(w.jobs['e2e-core-loop']['continue-on-error']).toBeUndefined();
 expect(h.jobs['backend-full'].needs).toContain('full-regression-core');expect(h.jobs['hourly-full-result'].needs).toContain('backend-full');
 expect(w.jobs.deploy).toBeUndefined();const images=parse(readFileSync('.github/workflows/image-release.yml','utf8'));expect(images.jobs.deploy.needs).toEqual(['plan','build','manifest']);
});
it('executes actual full-backend aggregate and rejects missing/failed/skipped/cancelled core-loop',()=>{
 const script=w.jobs['backend-full-result'].steps.find((s:any)=>s.run).run;
 const members=w.jobs['backend-full-result'].needs;
 const run=(needs:any,extra={})=>spawnSync('bash',['-c',script],{env:{...process.env,CI_FULL_NEEDS:JSON.stringify(needs),API_SOURCE:'local',...extra},encoding:'utf8'});
 const good=Object.fromEntries(members.map((name:string)=>[name,{result:'success'}]));expect(run(good).status).toBe(0);expect(run({}).status).not.toBe(0);const missing={...good};delete missing['gates-runtime'];expect(run(missing).status).not.toBe(0);
 for(const result of ['failure','cancelled','skipped',undefined])expect(run({...good,'e2e-core-loop':{result}}).status).not.toBe(0);
 const shared={...good,'gates-test':{result:'skipped'}};const sha='a'.repeat(40);
 expect(run(shared,{API_SOURCE:'acceptance-base',API_SOURCE_SHA:sha,GITHUB_SHA:sha}).status).toBe(0);
 expect(run(shared,{API_SOURCE:'acceptance-base',API_SOURCE_SHA:'b'.repeat(40),GITHUB_SHA:sha}).status).not.toBe(0);
 expect(run(shared).status).not.toBe(0);
});
