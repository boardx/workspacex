import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,existsSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
const require=createRequire(import.meta.url),ownerPath=require.resolve('../e2e/support/chat-refresh-owned-process.cjs'),owner=require(ownerPath);
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until(fn:()=>boolean,budget=7000){const end=Date.now()+budget;while(!fn()){if(Date.now()>end)throw Error('owned fixture deadline');await sleep(20);}}
for(const mode of ['success','timeout','SIGTERM'] as const)it(`cleans the runner group and a separately registered service group on ${mode}`,async()=>{
 const root=mkdtempSync(join(tmpdir(),'chat-owned-unit-')),dir=join(root,'logs');mkdirSync(dir);
 const scope=owner.scopeHash('unit-owned-only'),marker=join(root,'ready'),result=join(root,'result.json');
 const childCode=`const fs=require('node:fs'),{spawn}=require('node:child_process');const g=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});fs.appendFileSync(${JSON.stringify(join(dir,'service-launcher.jsonl'))},JSON.stringify({event:'child-start',scopeHash:${JSON.stringify(scope)},ownerPid:process.pid,pgid:g.pid})+'\\n');fs.writeFileSync(${JSON.stringify(marker)},'ready');${mode==='success'?"setTimeout(()=>process.exit(0),100)":mode==='timeout'?"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)":"setInterval(()=>{},1000)"}`;
 const script=join(root,'runner.cjs');writeFileSync(script,`const fs=require('node:fs'),o=require(${JSON.stringify(ownerPath)});const note=(event,data={})=>fs.appendFileSync(${JSON.stringify(join(dir,'production-build.jsonl'))},JSON.stringify({event,...data})+'\\n');(async()=>{const r=await o.runOwned(process.execPath,['-e',${JSON.stringify(childCode)}],{cwd:${JSON.stringify(root)},env:process.env,directory:${JSON.stringify(dir)},scope:${JSON.stringify(scope)},purpose:'build',note,budgetMs:${mode==='timeout'?700:0},graceMs:100});await o.cleanupOwned(${JSON.stringify(dir)},${JSON.stringify(scope)},note);fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({r,proof:o.remaining(${JSON.stringify(dir)},${JSON.stringify(scope)})}));})();`);
 const proc=spawn(process.execPath,[script],{stdio:'ignore'});let exited=false;proc.once('exit',()=>{exited=true;});
 try{
  await until(()=>existsSync(marker));if(mode==='SIGTERM')proc.kill('SIGTERM');await until(()=>exited);expect(existsSync(result)).toBe(true);
  const data=JSON.parse(readFileSync(result,'utf8'));expect(data.proof).toEqual({observed:2,groups:[],owners:[]});expect(data.r.code).toBe(mode==='success'?0:mode==='timeout'?124:1);
 }finally{
  await owner.cleanupOwned(dir,scope,()=>{}).catch(()=>{});if(!exited){proc.kill('SIGKILL');await until(()=>exited).catch(()=>{});}rmSync(root,{recursive:true,force:true});
 }
},10000);

it('external proof selects the latest scope rather than accepting an old already-gone scope',async()=>{
 const root=mkdtempSync(join(tmpdir(),'chat-proof-scope-')),dir=join(root,'apps/web/e2e/__evidence__/chat-refresh-diagnostics');mkdirSync(dir,{recursive:true});
 const old=spawn(process.execPath,['-e','process.exit(0)'],{detached:true,stdio:'ignore'});await new Promise<void>(r=>old.once('exit',()=>r()));
 const live=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
 const oldScope=owner.scopeHash('old-gone'),newScope=owner.scopeHash('current-live');
 writeFileSync(join(dir,'production-build.jsonl'),[
  {event:'comparison-start',scopeHash:oldScope},{event:'owned-start',scopeHash:oldScope,ownerPid:old.pid,pgid:old.pid},
  {event:'comparison-start',scopeHash:newScope},{event:'owned-start',scopeHash:newScope,ownerPid:live.pid,pgid:live.pid},
 ].map(r=>JSON.stringify(r)).join('\n')+'\n');
 try{
  const result=spawnSync(process.execPath,[ownerPath],{cwd:root,encoding:'utf8',timeout:3000});
  expect(result.status).toBe(1);expect(JSON.parse(result.stdout).groups).toContain(live.pid);
 }finally{await owner.cleanupOwned(dir,newScope,()=>{});rmSync(root,{recursive:true,force:true});}
});
it('an interrupted zero exit cannot represent completed scenarios',()=>{
 expect(owner.comparisonExitCode({code:0,interrupted:true})).toBe(1);
 expect(owner.comparisonExitCode({code:0,interrupted:false})).toBe(0);
 expect(owner.comparisonExitCode({code:7,interrupted:true})).toBe(7);
});
