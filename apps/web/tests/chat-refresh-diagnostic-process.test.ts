import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtempSync,existsSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {expect,it} from 'vitest';
const launcher=fileURLToPath(new URL('../e2e/support/chat-refresh-diagnostic-server.mjs',import.meta.url));
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const alive: (pid:number)=>boolean = createRequire(import.meta.url)('../e2e/support/chat-refresh-owned-process.cjs').alive;
async function until(check:()=>boolean,budget=6000){const deadline=Date.now()+budget;while(!check()){if(Date.now()>deadline)throw new Error('owned fixture cleanup deadline');await pause(20);}}
// Synthetic child processes only: no DB, Docker, browser, application or network connection.
for(const mode of ['normal','SIGTERM','SIGHUP','SIGQUIT','uncaught','wrapper-uncaught'] as const)it(`terminates owned grandchild after ${mode}`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'chat-diag-process-')),marker=join(dir,'pids.json');
 const code=`const{spawn}=require('node:child_process');const fs=require('node:fs');const grand=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(process.env.CHAT_DIAG_FIXTURE,JSON.stringify([process.pid,grand.pid]));${mode==='normal'?"setTimeout(()=>process.exit(0),150)":mode==='uncaught'?"setTimeout(()=>{throw new Error('fixture')},150)":"setInterval(()=>{},1000)"}`;
 const args=mode==='wrapper-uncaught'?['--input-type=module','-e',`process.argv=[process.execPath,${JSON.stringify(launcher)},'next',process.execPath,'-e',${JSON.stringify(code)}];await import(${JSON.stringify(launcher)});const fs=await import('node:fs');const ready=setInterval(()=>{if(fs.existsSync(process.env.CHAT_DIAG_FIXTURE)){clearInterval(ready);throw new Error('owned-wrapper-fixture');}},20);`]:[launcher,'next',process.execPath,'-e',code];
 const child=spawn(process.execPath,args,{cwd:dir,stdio:'ignore',env:{...process.env,WSX_CHAT_REFRESH_DIAGNOSTICS:'1',WORKSPACEX_ISOLATION_ID:'unit-owned-process-fixture',CHAT_DIAG_FIXTURE:marker}});
 let exited=false;child.once('exit',()=>{exited=true;});let owned:number[]=[];
 try{
  await until(()=>existsSync(marker));owned=JSON.parse(readFileSync(marker,'utf8')) as number[];
  if(mode.startsWith('SIG'))child.kill(mode as NodeJS.Signals);
  await until(()=>exited);await until(()=>owned.every(pid=>!alive(pid)));
  expect(owned.every(pid=>!alive(pid))).toBe(true);
 }finally{
  for(const pid of owned)if(alive(pid))try{process.kill(pid,'SIGKILL');}catch{}
  if(!exited){child.kill('SIGTERM');await until(()=>exited).catch(()=>child.kill('SIGKILL'));}
  rmSync(dir,{recursive:true,force:true});
 }
},12000);
it('launch failure exits without keeping the supervisor alive',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'chat-diag-launch-'));try{
  const child=spawn(process.execPath,[launcher,'api','/nonexistent-chat-diagnostic-fixture'],{cwd:dir,stdio:'ignore',env:{...process.env,WSX_CHAT_REFRESH_DIAGNOSTICS:'1',WORKSPACEX_ISOLATION_ID:'unit-owned-process-fixture'}});
  let code:number|null=null,exited=false;child.once('exit',value=>{code=value;exited=true;});await until(()=>exited);expect(code).toBe(1);
 }finally{rmSync(dir,{recursive:true,force:true});}
},10000);
