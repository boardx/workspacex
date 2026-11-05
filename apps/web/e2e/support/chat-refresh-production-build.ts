/** One experimental production build before Playwright's unchanged scenario budget. */
import {createRequire} from 'node:module';
import {existsSync,mkdirSync,lstatSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import config from '../../playwright.chat-read.config';
const require=createRequire(import.meta.url),core=require('./chat-refresh-diagnostic-core.cjs'),ownedProcesses=require('./chat-refresh-owned-process.cjs');
const web=fileURLToPath(new URL('../../',import.meta.url));
if(process.env.WSX_CHAT_REFRESH_PRODUCTION_WEB!=='1'||!process.env.WORKSPACEX_ISOLATION_ID)throw new Error('explicit isolated production comparison required');
const servers=Array.isArray(config.webServer)?config.webServer:[];
const server=servers.find(s=>s.command.includes('chat-refresh-diagnostic-server.mjs next next start'));
const env=server?.env,dist=env?.NEXT_DIST_DIR;
if(!env||!dist||!/^\.next-chat-refresh-[a-f0-9]{16}$/.test(dist)||env.NODE_ENV!=='production')throw new Error('production build/start environment missing');
const playwrightArgs=ownedProcesses.scenarioArguments(process.argv.slice(2));
const output=resolve(web,dist);
const owned=ownedProcesses.claimDist(output);
const directory=resolve(web,'e2e/__evidence__/chat-refresh-diagnostics');mkdirSync(directory,{recursive:true});
const write=core.boundedWriter(resolve(directory,'production-build.jsonl'));
const note=(event:string,fields:object={})=>write({event,...fields});
const scope=ownedProcesses.scopeHash(process.env.WORKSPACEX_ISOLATION_ID);
note('comparison-start',{scopeHash:scope,ownerPid:process.pid});
const exit=()=>ownedProcesses.killRecorded(directory,scope,'SIGKILL');process.once('exit',exit);
// Keep cancellation handled even between child close and awaited registry cleanup.
let interrupted=false;const onStop=()=>{interrupted=true;};
for(const s of ['SIGTERM','SIGINT','SIGHUP','SIGQUIT'])process.on(s,onStop);
async function main(){
 try{
  const local=createRequire(resolve(web,'package.json')),next=local.resolve('next/dist/bin/next');
  const start=Date.now();note('build-start',{budgetMs:600000});
  const built=await ownedProcesses.runOwned(process.execPath,[next,'build'],{cwd:web,env:{...process.env,...env},directory,scope,purpose:'build',note,budgetMs:600000});
  note('build-end',{durationMs:Date.now()-start,code:built.code});
  if(built.code!==0||built.interrupted||interrupted||!existsSync(resolve(output,'BUILD_ID'))){process.exitCode=built.code||1;return;}
  const result=await ownedProcesses.runOwned(process.execPath,[local.resolve('@playwright/test/cli'),'test',...playwrightArgs],{cwd:web,env:{...process.env},directory,scope,purpose:'scenarios',note,graceMs:10000});
  process.exitCode=ownedProcesses.comparisonExitCode(result);
 }finally{
  // Kill only groups registered by this isolation scope, wait for real absence,
  // then remove the exact directory inode claimed before the build.
  await ownedProcesses.cleanupOwned(directory,scope,note);
  for(const s of ['SIGTERM','SIGINT','SIGHUP','SIGQUIT'])process.off(s,onStop);
  if(interrupted&&!process.exitCode)process.exitCode=1;
  const current=lstatSync(output);if(current.dev===owned.dev&&current.ino===owned.ino&&!current.isSymbolicLink())rmSync(output,{recursive:true});
 }
}
void main().catch(()=>{note('comparison-failed');process.exitCode=1;});
