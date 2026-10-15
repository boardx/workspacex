import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,realpathSync,rmSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {spawn,spawnSync} from 'node:child_process';
import {productionCommand} from './next-production-command';

test('actual ESM phase entry loads the existing CommonJS config before invoking build',()=>{
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'cn-next-phase-entry-'))),preload=join(directory,'probe.cjs');
 writeFileSync(preload,"const cp=require('node:child_process'),{EventEmitter}=require('node:events');cp.spawn=(command,options)=>{if(options.env.NODE_ENV!=='production'||options.env.WORKSPACEX_RELEASE_BUILD!=='1')throw Error('PRODUCTION_BINDINGS');process.stdout.write('FIXED_BUILD_SPAWN '+command+'\\n');const child=new EventEmitter();setImmediate(()=>child.emit('exit',7,null));return child;};");
 const env={...process.env};for(const [i,name]of ['WORKSPACEX_API_PORT','WORKSPACEX_WEB_PORT','WORKSPACEX_MODEL_PROVIDER_PORT','WORKSPACEX_DEEP_AGENT_PROVIDER_PORT','WORKSPACEX_LOOPBACK_SANDBOX_PORT','WORKSPACEX_ASR_PROVIDER_PORT','WORKSPACEX_VISION_PROVIDER_PORT'].entries())env[name]=String(25000+i);
 try{
  const result=spawnSync(process.execPath,['--require',preload,'--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('tests/fixtures/cn-six-business/next-production-build.ts')],{cwd:process.cwd(),env,encoding:'utf8',timeout:10000,maxBuffer:65536});
  assert.equal(result.status,7,result.stdout+result.stderr);assert.match(result.stdout,/FIXED_BUILD_SPAWN node ..\/..\/tests\/fixtures\/cn-six-business\/next-production-launch.cjs build 25001/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('build and runtime derive identical production bindings from the actual startup shape',()=>{
 const server={command:'NEXT_PUBLIC_API_URL=http://127.0.0.1:25001 CHAT_READ_E2E_API_ORIGIN=http://127.0.0.1:25000 COPILOTKIT_V2_AGENT_ID=fixture-agent NEXT_DIST_DIR=.next-chat-read-e2e next dev -p 25001',env:{NEXT_FONT_GOOGLE_MOCKED_RESPONSES:'/fixed/fonts.cjs'}};
 const build=productionCommand(server,'build'),start=productionCommand(server,'start');
 assert.deepEqual(build.env,start.env);assert.equal(build.env.NODE_ENV,'production');assert.equal(build.env.WORKSPACEX_RELEASE_BUILD,'1');assert.match(build.command,/build 25001$/);assert.match(start.command,/start 25001$/);
 assert.throws(()=>productionCommand({...server,command:server.command+'; unexpected'},'build'));
});

test('real child build binds the served artifact, rejects stale/tampered output and propagates exit',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'cn-next-production-'))),web=join(root,'apps/web'),directory=join(root,'evidence');mkdirSync(web,{recursive:true});mkdirSync(directory,{mode:0o700});
 writeFileSync(join(root,'pnpm-lock.yaml'),'fixed-lock');mkdirSync(join(web,'public'));writeFileSync(join(web,'public/logo.txt'),'actual-public');
 const cli=join(root,'next-cli.cjs');
 writeFileSync(cli,`const fs=require('node:fs'),p=require('node:path');if(process.argv[2]!=='build'||process.env.NODE_ENV!=='production'||process.env.NODE_OPTIONS!=='--max-old-space-size=3072')throw Error('BUILD_ARGV');const d=p.join(process.cwd(),'.next-chat-read-e2e');for(const x of ['static','standalone/node_modules','standalone/apps/web/.next-chat-read-e2e/server'])fs.mkdirSync(p.join(d,x),{recursive:true});fs.writeFileSync(p.join(d,'standalone/node_modules/dep.js'),'runtime-dependency');fs.symlinkSync('dep.js',p.join(d,'standalone/node_modules/alias.js'));fs.writeFileSync(p.join(d,'standalone/apps/web/.next-chat-read-e2e/routes-manifest.json'),'runtime-routes');fs.writeFileSync(p.join(d,'BUILD_ID'),'build-identity');fs.writeFileSync(p.join(d,'standalone/apps/web/.next-chat-read-e2e/BUILD_ID'),'build-identity');fs.writeFileSync(p.join(d,'static/chunk.js'),'real-compiled-asset');fs.writeFileSync(p.join(d,'standalone/apps/web/.next-chat-read-e2e/server/page.js'),'real-route');fs.writeFileSync(p.join(d,'standalone/apps/web/server.js'),"if(process.env.PORT!=='25001'||process.env.HOSTNAME!=='127.0.0.1')throw Error('RUNTIME_BINDING');process.exitCode=7;");`);
 const source=resolve('tests/fixtures/cn-six-business/next-production-launch.cjs'),real=createRequire(source);let child:any,starts=0;
 const env={CN_RELEASE_FULLSTACK_FIXTURE:'1',CN_SIX_REPORT_PATH:join(directory,'report.json'),CN_SIX_SOURCE_COMMIT:'a'.repeat(40),NEXT_DIST_DIR:'.next-chat-read-e2e',NODE_ENV:'production',WORKSPACEX_RELEASE_BUILD:'1',NEXT_PUBLIC_API_URL:'http://127.0.0.1:25001',CHAT_READ_E2E_API_ORIGIN:'http://127.0.0.1:25000',COPILOTKIT_V2_AGENT_ID:'fixture-agent'};
 const fakeProcess={argv:['node',source,'build','25001'],env,execPath:process.execPath,getuid:process.getuid!.bind(process),on:()=>{},exitCode:0};const mod={exports:{}};
 const req:any=(name:string)=>name==='node:child_process'?{spawn:(...args:any[])=>{starts++;child=spawn(args[0],args[1],args[2]);return child;}}:real(name);req.resolve=(name:string)=>name==='next/dist/bin/next'?cli:real.resolve(name);req.main={};
 runInNewContext(readFileSync(source,'utf8'),{require:req,module:mod,__filename:source,__dirname:join(root,'tests/fixtures/cn-six-business'),process:fakeProcess,console,Buffer});
 try{
  await(mod.exports as any).main();await new Promise<void>(done=>child.once('close',()=>done()));assert.equal(fakeProcess.exitCode,0);
  const receipt=JSON.parse(readFileSync(join(directory,'next-build.json'),'utf8'));assert.equal(receipt.identity.sourceCommit,'a'.repeat(40));assert.equal(receipt.artifact.buildId,'build-identity');assert.ok(receipt.artifact.standalone.files>0);
  await assert.rejects((mod.exports as any).main());assert.equal(starts,1); // no stale build reuse
  fakeProcess.argv[2]='start';fakeProcess.env.CN_SIX_SOURCE_COMMIT='b'.repeat(40);await assert.rejects((mod.exports as any).main());assert.equal(starts,1);fakeProcess.env.CN_SIX_SOURCE_COMMIT='a'.repeat(40);
  const asset=join(web,'.next-chat-read-e2e/standalone/apps/web/.next-chat-read-e2e/static/chunk.js');writeFileSync(asset,'tampered');await assert.rejects((mod.exports as any).main());assert.equal(starts,1);writeFileSync(asset,'real-compiled-asset');
  for(const [relative,original]of [['node_modules/dep.js','runtime-dependency'],['apps/web/.next-chat-read-e2e/routes-manifest.json','runtime-routes']]){
   const target=join(web,'.next-chat-read-e2e/standalone',relative!);writeFileSync(target,'changed');await assert.rejects((mod.exports as any).main());assert.equal(starts,1);writeFileSync(target,original!);
  }
  await(mod.exports as any).main();await new Promise<void>(done=>child.once('close',()=>done()));assert.equal(fakeProcess.exitCode,7);assert.equal(starts,2);assert.ok(existsSync(join(directory,'next-production-start.json')));
  assert.equal(JSON.parse(readFileSync(join(directory,'next-production-start-exit.json'),'utf8')).exitCode,7);
  const marker=join(web,'public/foreign');symlinkSync(cli,marker);assert.throws(()=>(mod.exports as any).tree(join(web,'public')));
 }finally{rmSync(root,{recursive:true,force:true});}
});
