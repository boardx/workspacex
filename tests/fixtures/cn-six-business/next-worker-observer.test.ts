import {test} from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtempSync,realpathSync,chmodSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
const {install,delta,parseKernelOom}=createRequire(import.meta.url)('./next-worker-observer.cjs');
const directory=()=>{const p=realpathSync(mkdtempSync(join(tmpdir(),'cn-worker-observer-')));chmodSync(p,0o700);return p;};
const snapshot=(kills:number)=>({available:true,observations:[{inode:1,device:2,pathSha256:'a'.repeat(64),events:{oom:String(kills),oom_kill:String(kills)}}]});
test('real fork SIGKILL is recorded with PID, exit signal and bounded OOM correlation',async()=>{
 const root=directory(),server=join(root,'worker.cjs');writeFileSync(server,"process.send({ready:true});setInterval(()=>{},1000);\n");
 let reads=0,kernelCalls=0;
 const restore=install({server,directory:root,readResources:()=>snapshot(reads++===0?0:1),readKernel:(pid:number,since:string)=>{kernelCalls++;assert.match(since,/Z$/);return {available:true,ownedPid:pid,kernelOomKillConfirmed:false,fixture:true};}});
 try{
  const child=cp.fork(server,[],{execArgv:[],stdio:['ignore','ignore','ignore','ipc']});
  await new Promise<void>((resolve,reject)=>{child.once('message',()=>resolve());child.once('error',reject);});
  const completed=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGKILL');await completed;
  const start=JSON.parse(readFileSync(join(root,'next-worker-01-started.json'),'utf8'));
  const end=JSON.parse(readFileSync(join(root,'next-worker-01-exit.json'),'utf8'));
  assert.equal(start.worker.pid,child.pid);assert.equal(end.worker.pid,child.pid);assert.equal(end.cliPid,process.pid);
  assert.equal(end.signal,'SIGKILL');assert.equal(end.exitCode,null);assert.equal(end.oomDelta[0].oomKill,1);assert.equal(kernelCalls,1);
  // A test-injected kernel reader is explicitly NOT proof of a real OOM.
  assert.equal(end.kernel.kernelOomKillConfirmed,false);assert.equal(end.kernel.fixture,true);
  assert(BigInt(end.monotonicNs)>=BigInt(start.monotonicNs));assert.match(end.occurredAt,/Z$/);
 }finally{restore();rmSync(root,{recursive:true,force:true});}
});
test('normal child exit is preserved; unrelated fork is never observed and no kernel read occurs',async()=>{
 const root=directory(),server=join(root,'worker.cjs'),other=join(root,'other.cjs');
 writeFileSync(server,'process.exitCode=7;\n');writeFileSync(other,'process.exitCode=0;\n');
 const restore=install({server,directory:root,readResources:()=>snapshot(0),readKernel:()=>{throw Error('UNEXPECTED_KERNEL_READ');}});
 try{
  const child=cp.fork(server,[],{execArgv:[],stdio:'ignore'});await new Promise<void>(resolve=>child.once('exit',()=>resolve()));
  const end=JSON.parse(readFileSync(join(root,'next-worker-01-exit.json'),'utf8'));assert.equal(end.exitCode,7);assert.equal(end.signal,null);
  assert.equal(end.kernel.reason,'NO_CORRELATED_OOM_KILL');
  const unrelated=cp.fork(other,[],{execArgv:[],stdio:'ignore'});await new Promise<void>(resolve=>unrelated.once('exit',()=>resolve()));
  assert.equal(unrelated.exitCode,0);assert.equal(existsSync(join(root,'next-worker-02-started.json')),false);
 }finally{restore();rmSync(root,{recursive:true,force:true});}
});
test('resource identity drift cannot be treated as an OOM delta',()=>{
 assert.deepEqual(delta(snapshot(0),{available:false}),[]);
 assert.deepEqual(delta(snapshot(0),{observations:[{...snapshot(1).observations[0],inode:9}]}),[]);
});

test('kernel OOM parsing binds the actual killed PID and retains only time metadata',()=>{
 const text='[123.456] Memory cgroup out of memory: Killed process 4321 (node) private-payload\n[124.0] oom_reaper: reaped process 4321 (node)\n';
 const result=parseKernelOom(text,4321);assert.equal(result.kernelOomKillConfirmed,true);assert.equal(result.matchingRecords,1);assert.deepEqual(result.kernelMonotonicSeconds,['123.456']);assert(!JSON.stringify(result).includes('private-payload'));
 assert.equal(parseKernelOom(text,4321,{startedNs:'123000000000',exitedNs:'124000000000'}).kernelOomKillConfirmed,true);
 assert.equal(parseKernelOom(text,4321,{startedNs:'124000000000',exitedNs:'125000000000'}).kernelOomKillConfirmed,false);
 assert.equal(parseKernelOom(text,4321,{startedNs:'122000000000',exitedNs:'123000000000'}).kernelOomKillConfirmed,false);
 assert.equal(parseKernelOom(text,432).kernelOomKillConfirmed,false);
 assert.equal(parseKernelOom('[125] Killed process 4321 (node) unrelated',4321).kernelOomKillConfirmed,false);
});
test('cleanup-only leaf cgroup does not hide ancestor memory events',()=>{
 const source=resolve('tests/fixtures/cn-six-business/next-server-launch.cjs'),real=createRequire(source),mod={exports:{}};
 const values:any={'memory.current':'1024','memory.peak':'2048','memory.max':'6442450944','memory.events':'low 0\nhigh 0\nmax 1\noom 1\noom_kill 1\n'};
 const fakeFs={readFileSync:(file:string)=>file==='/proc/self/cgroup'?'0::/unit/cleanup\n':values[file.split('/').at(-1)!],existsSync:(file:string)=>file==='/sys/fs/cgroup/unit/memory.events',lstatSync:()=>({ino:1,dev:2,isDirectory:()=>true,isSymbolicLink:()=>false})};
 const req:any=(name:string)=>name==='node:fs'?fakeFs:real(name);req.resolve=real.resolve.bind(real);req.main={};
 runInNewContext(readFileSync(source,'utf8'),{require:req,module:mod,__filename:source,__dirname:resolve('tests/fixtures/cn-six-business'),process:{platform:'linux'},console});
 const result=(mod.exports as any).resources();assert.equal(result.available,true);assert.equal(result.observations.length,1);assert.equal(result.observations[0].events.oom_kill,'1');
});
