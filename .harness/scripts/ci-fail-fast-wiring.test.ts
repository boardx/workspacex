import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {parse} from 'yaml';
import {expect,it} from 'vitest';
const scripts=JSON.parse(readFileSync('package.json','utf8')).scripts;
it('CI commands stop on failure rather than continuing other modules',()=>{
 for(const name of ['verify:ci-base:raw','verify:ci-base-other:raw','verify:base:raw'])expect(scripts[name]).not.toContain('--continue');
 expect(scripts['verify:harness:raw']).toContain('--bail=1');
 for(const name of ['verify:ci-base:raw','verify:ci-base-other:raw','verify:base:raw'])expect(scripts[name]).toContain(' -- --bail=1');
});
it('CI runner commands bail internally instead of waiting for the remaining cases',()=>{
 for(const file of ['harness-verify','harness-acceptance','backend-gates','billing-cashier-glue','skill-files-e2e']){
  const workflow=parse(readFileSync(`.github/workflows/${file}.yml`,'utf8'));
  for(const job of Object.values(workflow.jobs) as any[])for(const step of job.steps??[])for(const line of (step.run??'').split('\n')){
   if(line.includes('vitest run'))expect(line).toContain('--bail=1');
   if(line.includes('playwright test')||line.includes('run e2e:trace-geometry'))expect(line).toContain('--max-failures=1');
  }
 }
 const api=JSON.parse(readFileSync('apps/api/package.json','utf8')).scripts.test;expect(api).toMatch(/^vitest run --bail=1 &&/);
 for(const [key,value]of Object.entries(scripts))if(key.startsWith('verify:')&&String(value).includes('playwright test'))expect(value,key).toContain('--max-failures=1');
});
it('test matrices cancel remaining shards and cancelable jobs do not ignore workflow cancellation',()=>{
 for(const file of ['harness-verify','harness-acceptance','backend-gates']){
  const workflow=parse(readFileSync(`.github/workflows/${file}.yml`,'utf8'));
  for(const job of Object.values(workflow.jobs) as any[]){
   if(job.strategy?.matrix)expect(job.strategy['fail-fast']).toBe(true);
   if(job.if?.includes('always()'))expect(job.if).toContain('!cancelled()');
   for(const step of job.steps??[])if(step.run?.includes('turbo run typecheck lint'))expect(step.run).not.toContain('--continue');
  }
 }
});
it('skips follow-up validations after primary failure while retaining evidence collection',()=>{
 for(const file of ['harness-verify','harness-acceptance']){
  const job=parse(readFileSync(`.github/workflows/${file}.yml`,'utf8')).jobs['fullstack-smoke'];
  const evaluate=(condition:string,success:boolean)=>new Function('always','success','steps',`return (${condition})`)(()=>true,()=>success,{dedup:{outputs:{run:'true'}}});
  for(const id of ['sticky','geometry']){
   const step=job.steps.find((s:any)=>s.id===id);expect(evaluate(step.if,false)).toBe(false);expect(evaluate(step.if,true)).toBe(true);
  }
  const evidence=job.steps.find((s:any)=>s.id==='evidence');expect(evaluate(evidence.if,false)).toBe(true);
 }
});
it('actual Turbo kills a running sibling instead of letting it finish after a failure',async()=>{
 const root=mkdtempSync(join(tmpdir(),'wsx-ci-fail-fast-')),started=join(root,'started'),finished=join(root,'finished');
 try{
  writeFileSync(join(root,'package.json'),JSON.stringify({name:'fail-fast-proof',private:true,packageManager:'pnpm@9.15.0'}));
  writeFileSync(join(root,'pnpm-workspace.yaml'),'packages:\n  - packages/*\n');
  writeFileSync(join(root,'turbo.json'),JSON.stringify({tasks:{test:{cache:false}}}));
  for(const [name,body] of [['failure',`const fs=require('node:fs');const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(started)})){clearInterval(t);process.exit(1)}},10);setTimeout(()=>process.exit(2),5000);`],['sibling',`require('node:fs').writeFileSync(${JSON.stringify(started)},'yes');setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(finished)},'unexpected'),1500);`]]){
   const dir=join(root,'packages',name);mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'test.cjs'),body!);writeFileSync(join(dir,'package.json'),JSON.stringify({name,scripts:{test:'node test.cjs'}}));
  }
  const args=['run','test','--concurrency=2','--log-order=stream'];if(scripts['verify:ci-base-other:raw'].includes('--continue'))args.push('--continue');
  const result=await new Promise<{code:number|null;output:string}>((done,reject)=>{let output='';const child=spawn(resolve('node_modules/.bin/turbo'),args,{cwd:root,env:{...process.env,TURBO_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);child.on('error',reject);child.on('close',code=>done({code,output}));});
  expect(result.code,result.output).not.toBe(0);expect(result.output).toContain('failure#test');expect(existsSync(started),result.output).toBe(true);
  await new Promise(done=>setTimeout(done,1700));expect(existsSync(finished),result.output).toBe(false);
 }finally{rmSync(root,{recursive:true,force:true});}
},15000);
it('actual Vitest skips later cases after the first failure and still runs cleanup',()=>{
 const root=mkdtempSync(join(tmpdir(),'wsx-vitest-fail-fast-')),primary=join(root,'primary'),first=join(root,'first'),later=join(root,'later'),cleaned=join(root,'cleaned');
 try{
  symlinkSync(resolve('node_modules'),join(root,'node_modules'),process.platform==='win32'?'junction':'dir');
  const api=JSON.parse(readFileSync('apps/api/package.json','utf8')).scripts.test;
  writeFileSync(join(root,'package.json'),JSON.stringify({name:'api-bail-proof',private:true,type:'module',scripts:{test:api}}));
  writeFileSync(join(root,'vitest.config.mjs'),`export default {test:{include:['primary.test.mjs'],fileParallelism:false,maxWorkers:1,minWorkers:1}};`);
  writeFileSync(join(root,'vitest.exclusive.config.ts'),`export default {test:{include:['case.test.mjs'],fileParallelism:false,maxWorkers:1,minWorkers:1}};`);
  writeFileSync(join(root,'primary.test.mjs'),`import {test,expect} from 'vitest';import {writeFileSync} from 'node:fs';test('primary pass',()=>{writeFileSync(${JSON.stringify(primary)},'yes');expect(true).toBe(true)});`);
  writeFileSync(join(root,'case.test.mjs'),`import {test,expect,afterAll} from 'vitest';import {writeFileSync} from 'node:fs';afterAll(()=>writeFileSync(${JSON.stringify(cleaned)},'yes'));test('intentional failure',()=>{writeFileSync(${JSON.stringify(first)},'yes');expect(1).toBe(2)});test('must not execute',()=>writeFileSync(${JSON.stringify(later)},'unexpected'));`);
  const forwarded=scripts['verify:ci-base-other:raw'].match(/ -- (--bail=1)$/)?.[1];
  const result=spawnSync('pnpm',['run','test',...(forwarded?[forwarded]:[])],{cwd:root,encoding:'utf8',timeout:15000});
  expect(result.status,result.stdout+result.stderr).toBe(1);expect(existsSync(primary),result.stdout+result.stderr).toBe(true);expect(existsSync(first),result.stdout+result.stderr).toBe(true);expect(existsSync(cleaned)).toBe(true);expect(existsSync(later)).toBe(false);
 }finally{rmSync(root,{recursive:true,force:true});}
},20000);
it('actual Playwright stops later cases after failure while retaining teardown',()=>{
 const root=mkdtempSync(join(tmpdir(),'wsx-playwright-fail-fast-')),first=join(root,'first'),later=join(root,'later'),cleaned=join(root,'cleaned');
 try{
  symlinkSync(resolve('apps/web/node_modules'),join(root,'node_modules'),process.platform==='win32'?'junction':'dir');
  writeFileSync(join(root,'playwright.config.mjs'),`export default {testDir:${JSON.stringify(root)},testMatch:'case.spec.mjs',workers:1,reporter:'line'};`);
  writeFileSync(join(root,'case.spec.mjs'),`import {test,expect} from '@playwright/test';import {writeFileSync} from 'node:fs';test.afterAll(()=>writeFileSync(${JSON.stringify(cleaned)},'yes'));test('intentional failure',()=>{writeFileSync(${JSON.stringify(first)},'yes');expect(1).toBe(2)});test('must not execute',()=>writeFileSync(${JSON.stringify(later)},'unexpected'));`);
  const flag=scripts['verify:fullstack-product:raw'].match(/(--max-failures=1)$/)?.[1];
  const result=spawnSync(process.execPath,[resolve('apps/web/node_modules/@playwright/test/cli.js'),'test','--config',join(root,'playwright.config.mjs'),...(flag?[flag]:[])],{cwd:root,encoding:'utf8',timeout:15000});
  expect(result.status,result.stdout+result.stderr).toBe(1);expect(existsSync(first),result.stdout+result.stderr).toBe(true);expect(existsSync(cleaned)).toBe(true);expect(existsSync(later)).toBe(false);
 }finally{rmSync(root,{recursive:true,force:true});}
},20000);

it('skill workflow command reaches isolation guard with its fixed first-failure browser arguments',()=>{
 const workflow=parse(readFileSync('.github/workflows/skill-files-e2e.yml','utf8'));
 const command=workflow.jobs['skill-files-e2e'].steps.find((s:any)=>s.run?.includes('studio-skill-files-e2e.mjs')).run;
 const args=command.slice(command.indexOf('scripts/studio-skill-files-e2e.mjs')).trim().split(/\s+/);
 const env={...process.env};delete env.WORKSPACEX_DB;
 const result=spawnSync(process.execPath,args,{env,encoding:'utf8',timeout:15000});
 expect(result.status,result.stderr).toBe(1);expect(result.stderr).toContain('test-isolation');expect(result.stderr).not.toContain('Only the fixed');
});
