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
const memoryObserver=createRequire(import.meta.url)('./next-memory-sample.cjs');
const phaseObserver=createRequire(import.meta.url)('./next-compiler-phase.cjs');
const fatalObserver=createRequire(import.meta.url)('./next-fatal-classifier.cjs');

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
 const fakeProcess={argv:['node',source,'25001'],env:{CN_RELEASE_FULLSTACK_FIXTURE:'1',CN_SIX_REPORT_PATH:join(directory,'report.json')},platform:process.platform,execPath:process.execPath,getuid:process.getuid!.bind(process),on:()=>{},stdout:{write:(b:Buffer)=>{forwarded+=b.toString();return true;},on:()=>{}},stderr:{write:(b:Buffer)=>{forwarded+=b.toString();return true;},on:()=>{}},exitCode:0};
 const req:any=(name:string)=>name==='node:child_process'?{spawn:(_exe:string,args:string[],options:any)=>{starts++;assert.deepEqual(Array.from(args).slice(3),['dev','-p','25001']);assert.equal(options.detached,false);assert.equal(options.env.NODE_OPTIONS,'--max-old-space-size=2048');actual=spawn(process.execPath,['-e',"process.stdout.write('fixture-out');process.stderr.write('fixture-err');process.exitCode=7"],options);return actual;}}:real(name);req.resolve=real.resolve.bind(real);req.main={};
 runInNewContext(readFileSync(source,'utf8'),{require:req,module:mod,__filename:source,__dirname:resolve('tests/fixtures/cn-six-business'),process:fakeProcess,console});
 try{
  (fakeProcess.env as any).NODE_OPTIONS='--max-old-space-size=4096';await assert.rejects((mod.exports as any).main());assert.equal(starts,0);assert.equal(existsSync(join(directory,'next-launch-intent.json')),false);
  delete (fakeProcess.env as any).NODE_OPTIONS;
  await(mod.exports as any).main();await new Promise<void>(done=>actual.once('close',()=>done()));
  const start=JSON.parse(readFileSync(join(directory,'next-launch-started.json'),'utf8'));const end=JSON.parse(readFileSync(join(directory,'next-launch-exit.json'),'utf8'));
  assert.equal(start.kind,'cn-next-launch-v1');assert.equal(end.exitCode,7);assert.equal(fakeProcess.exitCode,7);assert.equal(end.output.stdoutBytes,11);assert.equal(end.output.stderrBytes,11);assert.equal(end.fatal.unknown,true);assert.equal(end.fatal.jsHeapOom,false);assert.match(forwarded,/fixture-out/);assert.match(forwarded,/fixture-err/);assert.equal(starts,1);
  assert.equal(end.output.stdoutSha256,createHash('sha256').update('fixture-out').digest('hex'));assert.equal(end.output.stderrSha256,createHash('sha256').update('fixture-err').digest('hex'));
  await assert.rejects((mod.exports as any).main());assert.equal(starts,1);
  fakeProcess.argv[2]='invalid';await assert.rejects((mod.exports as any).main());assert.equal(starts,1);
  assert.equal(existsSync(join(directory,'next-launch-intent.json')),true);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('fixed observer preserves fork arguments and retains signal without exposing environment',()=>{
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'cn-next-worker-')));chmodSync(directory,0o700);
 const source=resolve('tests/fixtures/cn-six-business/next-worker-observer.cjs'),real=createRequire(source);
 const cli=real.resolve('next/dist/bin/next',{paths:[resolve('apps/web')]}),worker=real.resolve('next/dist/server/lib/start-server',{paths:[resolve('apps/web')]});
 const listeners:Record<string,Function>={};let listenerAdds=0;const child={pid:process.pid,on:(event:string,fn:Function)=>{listenerAdds++;listeners[event]=fn;return child;}};let seen:any[]=[];
 const cp={fork:(...args:any[])=>{seen=args;return child;}};const options={env:{NODE_OPTIONS:'--max-old-space-size=2048',SECRET:'never-export'}};
 const req:any=(name:string)=>name==='node:child_process'?cp:real(name);req.resolve=real.resolve.bind(real);
 try{
  runInNewContext(readFileSync(source,'utf8'),{require:req,module:{exports:{}},__dirname:resolve('tests/fixtures/cn-six-business'),process:{argv:['node',cli],env:{CN_RELEASE_FULLSTACK_FIXTURE:'1',CN_SIX_REPORT_PATH:join(directory,'report.json')},getuid:process.getuid!.bind(process)}});
  assert.equal(cp.fork(worker,[],options),child);assert.equal(seen[2],options);listeners.spawn!();listeners.exit!(null,'SIGKILL');
  const raw=readFileSync(join(directory,'next-worker-1.json'),'utf8'),receipt=JSON.parse(raw);
  assert.ok(receipt.elapsedMilliseconds>=0);assert.match(receipt.forkedAt,/^20[0-9]{2}-/);assert.match(receipt.exitedAt,/^20[0-9]{2}-/);assert.equal(receipt.signal,'SIGKILL');assert.equal(receipt.exitCode,null);assert.equal(receipt.heapMiB,2048);assert.equal(raw.includes('never-export'),false);assert.equal(raw.includes(worker),false);
  cp.fork('/unrelated-worker',[],options);assert.equal(seen[0],'/unrelated-worker');
  for(let i=0;i<3;i++)cp.fork(worker,[],options);const beforeFifth=listenerAdds;cp.fork(worker,[],options);assert.equal(listenerAdds,beforeFifth);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('resource observation retains memory-enabled parent of a domain without controllers',()=>{
 const source=resolve('tests/fixtures/cn-six-business/next-server-launch.cjs'),real=createRequire(source),mod={exports:{}};
 const base=real('node:fs');const fakeFs={...base,lstatSync:()=>({ino:1,dev:2,isDirectory:()=>true,isSymbolicLink:()=>false}),readFileSync:(p:string,...rest:any[])=>{
  if(p==='/proc/self/cgroup')return '0::/system.slice/unit/domain\n';
  if(p.startsWith('/sys/fs/cgroup/')){if(p.includes('/domain/'))throw Object.assign(Error('missing'),{code:'ENOENT'});return p.endsWith('memory.events')?'oom 0\noom_kill 0\n':'6442450944\n';}
  return base.readFileSync(p,...rest);
 }};
 const req:any=(name:string)=>name==='node:fs'?fakeFs:real(name);req.resolve=real.resolve.bind(real);req.main={};
 runInNewContext(readFileSync(source,'utf8'),{require:req,module:mod,__filename:source,__dirname:resolve('tests/fixtures/cn-six-business'),process:{platform:'linux'}});
 const result=(mod.exports as any).resources();assert.equal(result.available,true);assert.equal(result.observations[0].controllerFilesUnavailable,true);assert.equal(result.observations[1]['memory.max'],'6442450944');
 fakeFs.readFileSync=()=>{throw Object.assign(Error('denied'),{code:'EACCES'});};assert.equal((mod.exports as any).resources().available,false);
});


test('fixture heap budget is enforced by the actual Node runtime',()=>{
 const result=spawnSync(process.execPath,['-e',"console.log(require('node:v8').getHeapStatistics().heap_size_limit)"],{env:{...process.env,NODE_OPTIONS:'--max-old-space-size=2048'},encoding:'utf8',timeout:10000});
 assert.equal(result.status,0);const bytes=Number(result.stdout.trim());assert.ok(bytes>=2048*1024*1024&&bytes<2304*1024*1024);
});

test('fixed numeric memory topic is ignored by the installed Next parent handshake',()=>{
 const require=createRequire(import.meta.url);
 const cli=require.resolve('next/dist/cli/next-dev',{paths:[resolve('apps/web')]});
 const source=readFileSync(cli,'utf8');
 const match=source.match(/child\.on\("message", \(msg\)=>\{([\s\S]*?)\n {12}\}\);/);
 assert.ok(match,'installed Next message handler must remain explicitly verified');
 let sends=0,resolves=0;
 const make=new Function('child','startServerOptions','resolve',`let resolved=false;return(msg)=>{${match[1]}};`);
 const handler=make({send:()=>{sends++;}},{fixture:true},()=>{resolves++;});
 handler({[memoryObserver.TAG]:1,pid:123,sample:1,elapsedMilliseconds:0,rssBytes:100,heapTotalBytes:80,heapUsedBytes:50,externalBytes:10,arrayBuffersBytes:5});
 handler({[phaseObserver.TAG]:1,pid:123,compiler:1,event:1,phase:1});
 assert.equal(sends,0);assert.equal(resolves,0);
 handler({nextWorkerReady:true});assert.equal(sends,1);assert.equal(resolves,0);
 handler({nextServerReady:true});assert.equal(resolves,1);handler({nextServerReady:true});assert.equal(resolves,1);
});

test('sampler bounds frequency and packet count, unrefs its timer and unloads on disconnect',()=>{
 let now=0,callback:Function=()=>{},unrefs=0,clears=0;const hooks:Record<string,Function>={},packets:any[]=[];
 const actor={pid:123,connected:true,once:(k:string,fn:Function)=>{hooks[k]=fn;},memoryUsage:()=>({rss:100,heapTotal:80,heapUsed:50,external:10,arrayBuffers:5}),send:(packet:unknown)=>{packets.push(packet);}};
 const timers={setInterval:(fn:Function,ms:number)=>{assert.equal(ms,5000);callback=fn;return{unref:()=>{unrefs++;}};},clearInterval:()=>{clears++;}};
 memoryObserver.startSampler(actor,timers,()=>now);
 for(let i=1;i<=125;i++){now=i*5000;callback();}
 assert.equal(packets.length,120);assert.equal(unrefs,1);assert.ok(clears>0);
 for(const packet of packets)assert.ok(Object.values(packet).every(v=>Number.isSafeInteger(v)&&Number(v)>=0));
 const before=packets.length;hooks.disconnect!();callback();assert.equal(packets.length,before);
});

test('collector binds child PID and numeric shape, rejects secrets, reuse and oversampling',()=>{
 let listener:Function=()=>{};const child={pid:123,on:(_event:string,fn:Function)=>{listener=fn;}};
 const snapshot=memoryObserver.collect(child),packet={[memoryObserver.TAG]:1,pid:123,sample:1,elapsedMilliseconds:0,rssBytes:100,heapTotalBytes:80,heapUsedBytes:50,externalBytes:10,arrayBuffersBytes:5};
 listener({nextWorkerReady:true});listener({...packet,pid:999});listener({...packet,secret:'do-not-retain'});listener({...packet,rssBytes:-1});listener({...packet,rssBytes:NaN});
 listener(packet);listener({...packet,sample:2,elapsedMilliseconds:100});
 let result=snapshot();assert.equal(result.observedSamples,1);assert.equal(result.rejectedSamples,5);assert.equal(JSON.stringify(result).includes('do-not-retain'),false);
 for(let i=2;i<=120;i++)listener({...packet,sample:i,elapsedMilliseconds:i*5000});
 listener({...packet,sample:121,elapsedMilliseconds:605000});result=snapshot();assert.equal(result.observedSamples,120);assert.equal(result.capReached,true);assert.equal(result.rejectedSamples,6);
});


test('compiler phase observer bounds hooks, counts and numeric-only collection',()=>{
 const packets:any[]=[];const actor={pid:123,connected:true,memoryUsage:()=>({rss:100,heapTotal:80,heapUsed:50,external:10,arrayBuffers:5}),send:(m:any)=>packets.push(m)};
 let time=0,adds=0;const hooks:Record<string,Function>={};const compiler={hooks:Object.fromEntries([...phaseObserver.PHASES,'buildModule'].map((k:string)=>[k,{tap:(_name:string,fn:Function)=>{adds++;hooks[k]=fn;}}]))};
 compiler.hooks.thisCompilation={tap:(_name:string,fn:Function)=>{adds++;fn(compiler);}};
 const plugin=phaseObserver.plugin('client',actor,()=>time++);plugin.apply(compiler);plugin.apply(compiler);assert.equal(adds,7);
 const modules={size:42,buffer:()=>{throw Error('must not allocate');},toJSON:()=>{throw Error('must not serialize');}};
 hooks.finishModules(modules);hooks.seal();for(let i=0;i<40;i++)hooks.afterDone({modules});assert.equal(packets.length,8);assert.equal(packets[0].moduleCount,42);assert.equal(packets[1].moduleCountAvailable,0);
 actor.connected=false;hooks.finishModules(modules);assert.equal(packets.length,8);
 for(const name of ['unknown','constructor','__proto__','toString'])assert.equal(phaseObserver.plugin(name,actor),null);for(let i=0;i<5;i++)assert.ok(phaseObserver.plugin('server',actor));assert.equal(phaseObserver.plugin('server',actor),null);
 let listener:Function=()=>{};const snapshot=phaseObserver.collect({pid:123,on:(_k:string,fn:Function)=>{listener=fn;}});
 listener({...packets[0],secret:'never-retain'});listener({...packets[0],pid:999});listener({...packets[0],rssBytes:NaN});for(const p of packets)listener(p);listener({...packets.at(-1),event:9});
 const result=snapshot();assert.equal(result.events.length,8);assert.equal(result.rejectedEvents,4);assert.equal(JSON.stringify(result).includes('never-retain'),false);
 const worst={...packets[0]};for(const k of Object.keys(worst))if(!['pid','compiler','phase','event',phaseObserver.TAG,'moduleCountAvailable'].includes(k))worst[k]=Number.MAX_SAFE_INTEGER;assert.ok(Buffer.byteLength(JSON.stringify({compilerPhases:{events:Array.from({length:24},()=>worst)},memory:{padding:'x'.repeat(4096)}}))<16384);
});

test('fatal classifier detects fixed phrases across chunks without retaining stderr',()=>{
 for(const split of [1,5,12,29]){
  const classifier=fatalObserver.classifier();const bytes=Buffer.from('secret FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory secret');
  for(let i=0;i<bytes.length;i+=split)classifier.feed(bytes.subarray(i,i+split));
  assert.deepEqual(classifier.snapshot(),{jsHeapOom:true,otherFatal:false,unknown:false,fatalMarkerCount:1,jsHeapOomMarkerCount:1});assert.equal(JSON.stringify(classifier.snapshot()).includes('secret'),false);
 }
 const other=fatalObserver.classifier();other.feed(Buffer.from('FATAL ERROR: other'));assert.equal(other.snapshot().otherFatal,true);assert.equal(fatalObserver.classifier().snapshot().unknown,true);
});

test('real Next config enables phase plugin only in connected dev fixture',()=>{
 const configPath=resolve('apps/web/next.config.mjs');
 const script=`import cfg from ${JSON.stringify('file://'+configPath)};import assert from 'node:assert/strict';
 class Stub {constructor(...args){}};
 const run=(fixture,connected,dev,name)=>{process.env.CN_RELEASE_FULLSTACK_FIXTURE=fixture;Object.defineProperty(process,'connected',{value:connected,configurable:true});const c={name,plugins:[]};return cfg.webpack(c,{webpack:{NormalModuleReplacementPlugin:Stub,DefinePlugin:Stub},isServer:false,dev}).plugins.length;};
 const baseline=run('0',true,true,'client');assert.equal(run('1',false,true,'client'),baseline);assert.equal(run('1',true,false,'client'),baseline);assert.equal(run('1',true,true,'unknown'),baseline);assert.equal(run('1',true,true,'client'),baseline+1);`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stderr);
});


test('phase plugin applies to the real installed webpack Compiler and Compilation',()=>{
 const w=createRequire(import.meta.url)(resolve('apps/web/node_modules/next/dist/compiled/webpack/webpack'));w.init();
 const configured=w.webpack({mode:'development',context:process.cwd(),entry:{},output:{path:process.cwd()}});const compiler=new w.webpack.Compiler(process.cwd(),configured.options);
 const packets:any[]=[];const actor={pid:123,connected:true,memoryUsage:()=>({rss:100,heapTotal:80,heapUsed:50,external:10,arrayBuffers:5}),send:(m:any)=>packets.push(m)};
 phaseObserver.plugin('server',actor).apply(compiler);
 const compilation=new w.webpack.Compilation(compiler);compilation.modules.add({});compiler.hooks.thisCompilation.call(compilation,{});compilation.hooks.buildModule.call({});
 compilation.hooks.finishModules.callAsync(new Set([{}]),()=>{});compilation.hooks.seal.call();
 compiler.hooks.afterCompile.callAsync(compilation,()=>{});compiler.hooks.afterEmit.callAsync(compilation,()=>{});compiler.hooks.afterDone.call({compilation});
 assert.deepEqual(packets.map(p=>p.phase),[6,1,2,3,4,5]);assert.equal(packets[0].moduleCount,1);
});

test('production config loads with no repository fixture helper present',()=>{
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'cn-config-prod-')));
 try{
  const config=readFileSync(resolve('apps/web/next.config.mjs'),'utf8').replace("'./e2e/support/board-provider-receipt-build.mjs'",JSON.stringify('file://'+resolve('apps/web/e2e/support/board-provider-receipt-build.mjs')));
  const file=join(directory,'next.config.mjs');writeFileSync(file,config);
  const script=`import cfg from ${JSON.stringify('file://'+file)};class Stub{};for(const [fixture,dev] of [['0',true],['1',false]]){process.env.CN_RELEASE_FULLSTACK_FIXTURE=fixture;Object.defineProperty(process,'connected',{value:true,configurable:true});cfg.webpack({name:'client',plugins:[]},{webpack:{NormalModuleReplacementPlugin:Stub,DefinePlugin:Stub},isServer:false,dev});}`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stderr);
 }finally{rmSync(directory,{recursive:true,force:true});}
});


test('cold empty compiles preserve the shared event budget for bounded build milestones',()=>{
 const packets:any[]=[];let reads=0;const actor={pid:123,connected:true,memoryUsage:()=>{reads++;return {rss:100,heapTotal:80,heapUsed:50,external:10,arrayBuffers:5};},send:(m:any)=>packets.push(m)};
 const compiler=(name:string)=>{const hooks:Record<string,Function>={};const c={hooks:Object.fromEntries(['thisCompilation','afterCompile','afterEmit','afterDone'].map(k=>[k,{tap:(_n:string,fn:Function)=>hooks[k]=fn}]))};phaseObserver.plugin(name,actor).apply(c);return hooks;};
 const comp=()=>{const hooks:Record<string,Function>={};return {modules:new Set(),hooks:Object.fromEntries(['finishModules','seal','buildModule'].map(k=>[k,{tap:(_n:string,fn:Function)=>hooks[k]=fn}])),callbacks:hooks};};
 const client=compiler('client'),server=compiler('server'),edge=compiler('edge-server');
 const emptyCompile=(hooks:Record<string,Function>)=>{const c=comp();hooks.thisCompilation(c);c.callbacks.finishModules?.(c.modules);c.callbacks.seal?.();hooks.afterCompile(c);hooks.afterEmit(c);hooks.afterDone({compilation:c});};
 for(let round=0;round<2;round++)for(const hooks of [client,server,edge])emptyCompile(hooks);
 assert.equal(packets.length,0);assert.equal(reads,0);
 const active=comp();client.thisCompilation(active);for(let i=0;i<512;i++)active.callbacks.buildModule({source:()=>{throw Error('never read source');}});
 assert.deepEqual(packets.map(m=>m.buildModuleCallbacks),[1,256,512]);assert.ok(packets.every(m=>m.moduleCount===0&&m.emptyEventsSkipped===10&&m.phase===6));
 const another=comp();client.thisCompilation(another);another.callbacks.buildModule({});assert.equal(packets.length,3);
 active.modules.add({});active.callbacks.finishModules(active.modules);active.callbacks.seal();client.afterCompile(active);client.afterEmit(active);client.afterDone({compilation:active});assert.equal(packets.length,8);
 let listener:Function=()=>{};const snapshot=phaseObserver.collect({pid:123,on:(_k:string,fn:Function)=>listener=fn});
 listener({nextWorkerReady:true});listener({...packets[0],buildModuleCallbacks:2});listener({...packets[0],phase:7});listener({...packets[0],secret:'never-retain'});for(const m of packets)listener(m);
 assert.equal(snapshot().events.length,8);assert.equal(snapshot().rejectedEvents,3);
 const secondActor={...actor,send:(_m:any)=>{throw Error('empty cap must close before emission');}};const capHooks:Record<string,Function>={};const capped={hooks:Object.fromEntries(['thisCompilation','afterCompile','afterEmit','afterDone'].map(k=>[k,{tap:(_n:string,fn:Function)=>capHooks[k]=fn}]))};phaseObserver.plugin('client',secondActor).apply(capped);
 for(let i=0;i<100;i++)emptyCompile(capHooks);const last=comp();capHooks.thisCompilation(last);assert.equal(Object.keys(last.callbacks).length,0);
});

test('complete worst-case worker envelope with phase records remains below 16KiB',()=>{
 const max=Number.MAX_SAFE_INTEGER;const event={pid:max,compiler:3,event:8,phase:6,elapsedMilliseconds:max,moduleCountAvailable:1,moduleCount:max,buildModuleCallbacks:16384,emptyEventsSkipped:63,rssBytes:max,heapTotalBytes:max,heapUsedBytes:max,externalBytes:max,arrayBuffersBytes:max};
 const memoryNumbers={rssBytes:max,heapTotalBytes:max,heapUsedBytes:max,externalBytes:max,arrayBuffersBytes:max};
 const receipt={kind:'cn-next-worker-exit-v1',forkedAt:'2026-10-13T05:56:13.775Z',exitedAt:'2026-10-13T05:57:54.890Z',elapsedMilliseconds:max,workerPathSha256:'a'.repeat(64),process:{pid:max,startTicks:String(max),cgroup:{inode:max,device:max,pathSha256:'b'.repeat(64)}},heapMiB:2048,exitCode:null,signal:'SIGABRT',memory:{observedSamples:120,rejectedSamples:120,maxSamples:120,intervalMilliseconds:5000,capReached:true,latest:{pid:max,sample:120,elapsedMilliseconds:max,...memoryNumbers},observedPeaks:memoryNumbers},compilerPhases:{available:true,maxEventsPerCompiler:8,maxCompilers:3,maxEmptyEventsPerCompiler:64,maxCompilationsPerCompiler:16,rejectedEvents:24,events:Array.from({length:24},()=>event)}};
 assert.ok(Buffer.byteLength(JSON.stringify(receipt))<16384);
});
