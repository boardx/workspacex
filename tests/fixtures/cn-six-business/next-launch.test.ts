import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {mkdtempSync,symlinkSync,writeFileSync,chmodSync,rmSync,readFileSync,existsSync,realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';

test('actual six config resolves installed web Next without inherited workspace bin PATH',async()=>{
 const before={...process.env};
 const isolatedBin=mkdtempSync(join(tmpdir(),'cn-next-path-'));
 const quote=(v:string)=>"'"+v.replace(/'/g,"'\"'\"'")+"'";
 try{
  for(const [index,name]of ['WORKSPACEX_API_PORT','WORKSPACEX_WEB_PORT','WORKSPACEX_MODEL_PROVIDER_PORT','WORKSPACEX_DEEP_AGENT_PROVIDER_PORT','WORKSPACEX_LOOPBACK_SANDBOX_PORT','WORKSPACEX_ASR_PROVIDER_PORT','WORKSPACEX_VISION_PROVIDER_PORT'].entries())process.env[name]=String(25000+index);
  // Executable binding fixture only; this test never launches a browser.
  process.env.CN_TEST_CHROMIUM=process.execPath;
  process.env.CN_RELEASE_FULLSTACK_FIXTURE='1';process.env.CN_SIX_INFRA_RECEIPT='/var/lib/fixture-not-executed/infra.json';
  delete process.env.WORKSPACEX_REUSE_INFRA;delete process.env.CN_SIX_REPORT_PATH;delete process.env.CN_SIX_OUTPUT_DIR;
  const {default:config}=await import('../../../apps/web/playwright.cn-six-business.config');
  assert.equal(config.use?.launchOptions?.executablePath,process.execPath);
  assert.deepEqual(config.use?.launchOptions?.args,['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']);
  assert.deepEqual(config.use?.permissions,['microphone']);
  const servers=Array.isArray(config.webServer)?config.webServer:[];
  const next=servers.filter(s=>s.command.includes('NEXT_DIST_DIR=.next-chat-read-e2e'));
  assert.equal(next.length,1);assert.match(next[0]!.command,/node ..\/..\/tests\/fixtures\/cn-six-business\/next-server-launch.cjs 25001$/);
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
  const versionCommand=next[0]!.command.replace(/next-server-launch\.cjs [0-9]+$/,'next-server-launch.cjs --version');
  const output=execFileSync('/bin/sh',['-c',versionCommand],{cwd,env,encoding:'utf8',timeout:10000});
  assert.match(output,/^Next\.js v[0-9]+\./);
 }finally{
  rmSync(isolatedBin,{recursive:true,force:true});
  for(const name of Object.keys(process.env))if(!(name in before))delete process.env[name];
  Object.assign(process.env,before);
 }
});

test('fixed supervisor records real child exit and forwards output without retry',async()=>{
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'cn-next-supervisor-')));chmodSync(directory,0o700);
 const source=resolve('tests/fixtures/cn-six-business/next-server-launch.cjs');const real=createRequire(source);
 let starts=0;let actual:any;let forwarded='';const mod={exports:{}};
 const fakeProcess={argv:['node',source,'25001'],env:{CN_RELEASE_FULLSTACK_FIXTURE:'1',CN_SIX_REPORT_PATH:join(directory,'report.json'),NODE_OPTIONS:'--max-old-space-size=8192'},platform:process.platform,execPath:process.execPath,getuid:process.getuid!.bind(process),on:()=>{},stdout:{write:(b:Buffer)=>{forwarded+=b.toString();return true;},on:()=>{}},stderr:{write:(b:Buffer)=>{forwarded+=b.toString();return true;},on:()=>{}},exitCode:0};
 const req:any=(name:string)=>name==='node:child_process'?{spawn:(_exe:string,args:string[],options:any)=>{starts++;assert.deepEqual(Array.from(args).slice(1),['dev','-p','25001']);assert.equal(options.detached,false);assert.equal(options.env.NODE_OPTIONS,'--max-old-space-size=3072');actual=spawn(process.execPath,['-e',"if(require('node:v8').getHeapStatistics().heap_size_limit>3200*1024**2||require('next/dist/server/lib/utils').getMaxOldSpaceSize()!==3072)throw Error('HEAP_BOUND_NOT_INHERITED');process.stdout.write('fixture-out');process.stderr.write('fixture-err');process.exitCode=7"],options);return actual;}}:real(name);req.resolve=real.resolve.bind(real);req.main={};
 runInNewContext(readFileSync(source,'utf8'),{require:req,module:mod,__filename:source,__dirname:resolve('tests/fixtures/cn-six-business'),process:fakeProcess,console});
 try{
  await(mod.exports as any).main();await new Promise<void>(done=>actual.once('close',()=>done()));
  const start=JSON.parse(readFileSync(join(directory,'next-launch-started.json'),'utf8'));const end=JSON.parse(readFileSync(join(directory,'next-launch-exit.json'),'utf8'));
  assert.equal(start.kind,'cn-next-launch-v1');assert.equal(start.maxOldSpaceMiB,3072);assert.equal(end.exitCode,7);assert.equal(fakeProcess.exitCode,7);assert.equal(end.output.stdoutBytes,11);assert.equal(end.output.stderrBytes,11);assert.match(forwarded,/fixture-out/);assert.match(forwarded,/fixture-err/);assert.equal(starts,1);
  assert.equal(end.output.stdoutSha256,createHash('sha256').update('fixture-out').digest('hex'));assert.equal(end.output.stderrSha256,createHash('sha256').update('fixture-err').digest('hex'));
  await assert.rejects((mod.exports as any).main());assert.equal(starts,1);
  fakeProcess.argv[2]='invalid';await assert.rejects((mod.exports as any).main());assert.equal(starts,1);
  assert.equal(existsSync(join(directory,'next-launch-intent.json')),true);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
