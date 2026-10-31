import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {parse} from 'yaml';
import {expect,it} from 'vitest';
const scripts=JSON.parse(readFileSync('package.json','utf8')).scripts;
it('CI commands stop on failure rather than continuing other modules',()=>{
 for(const name of ['verify:ci-base:raw','verify:ci-base-other:raw','verify:base:raw'])expect(scripts[name]).not.toContain('--continue');
 expect(scripts['verify:harness:raw']).toContain('--bail=1');
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
