import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {mkdtempSync,symlinkSync,writeFileSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';

test('actual six config resolves installed web Next without inherited workspace bin PATH',async()=>{
 const before={...process.env};
 const isolatedBin=mkdtempSync(join(tmpdir(),'cn-next-path-'));
 const quote=(v:string)=>"'"+v.replace(/'/g,"'\"'\"'")+"'";
 try{
  for(const [index,name]of ['WORKSPACEX_API_PORT','WORKSPACEX_WEB_PORT','WORKSPACEX_MODEL_PROVIDER_PORT','WORKSPACEX_DEEP_AGENT_PROVIDER_PORT','WORKSPACEX_LOOPBACK_SANDBOX_PORT','WORKSPACEX_ASR_PROVIDER_PORT','WORKSPACEX_VISION_PROVIDER_PORT'].entries())process.env[name]=String(25000+index);
  process.env.CN_RELEASE_FULLSTACK_FIXTURE='1';process.env.CN_SIX_INFRA_RECEIPT='/var/lib/fixture-not-executed/infra.json';
  delete process.env.WORKSPACEX_REUSE_INFRA;delete process.env.CN_SIX_REPORT_PATH;delete process.env.CN_SIX_OUTPUT_DIR;
  const {default:config}=await import('../../../apps/web/playwright.cn-six-business.config');
  const servers=Array.isArray(config.webServer)?config.webServer:[];
  const next=servers.filter(s=>s.command.includes('NEXT_DIST_DIR=.next-chat-read-e2e'));
  assert.equal(next.length,1);assert.match(next[0]!.command,/pnpm --filter web exec next dev -p 25001$/);
  // Resolve pnpm before sanitizing PATH. GitHub action-setup installs pnpm in
  // its own node_modules/.bin, which is not the web workspace's Next bin.
  const pnpm=execFileSync('/bin/sh',['-c','command -v pnpm'],{encoding:'utf8',timeout:10000}).trim();
  assert.ok(pnpm.startsWith('/'));
  symlinkSync(process.execPath,join(isolatedBin,'node'));
  const launcher=join(isolatedBin,'pnpm');writeFileSync(launcher,'#!/bin/sh\nexec '+quote(pnpm)+' "$@"\n');chmodSync(launcher,0o700);
  const env={...process.env,PATH:isolatedBin+':/usr/bin:/bin'};
  const cwd=resolve('apps/web');
  // Reproduce the original direct-launch environment without starting a server.
  const old=spawnSync('/bin/sh',['-c','next --version'],{cwd,env,encoding:'utf8',timeout:10000});
  assert.notEqual(old.status,0);
  const versionCommand=next[0]!.command.replace(/next dev -p [0-9]+$/,'next --version');
  const output=execFileSync('/bin/sh',['-c',versionCommand],{cwd,env,encoding:'utf8',timeout:10000});
  assert.match(output,/^Next\.js v[0-9]+\./);
 }finally{
  rmSync(isolatedBin,{recursive:true,force:true});
  for(const name of Object.keys(process.env))if(!(name in before))delete process.env[name];
  Object.assign(process.env,before);
 }
});
