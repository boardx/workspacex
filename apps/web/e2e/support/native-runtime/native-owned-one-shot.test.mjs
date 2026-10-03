import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createOwnedOneShots,ownedGroupAlive} from './native-owned-one-shot.mjs';
const require=createRequire(import.meta.url);require('tsx/cjs/api').register();
const {startManaged,killTree,runToCompletion}=require('../../../../../packages/local-runtime/src/processes.ts');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const wait=async condition=>{const deadline=Date.now()+3000;while(!condition()){assert(Date.now()<deadline,'fixture deadline');await sleep(10);}};
const fixture=(directory,holdParent=false)=>{
 const file=join(directory,'writes'),pids=join(directory,'pids');
 const writer=`const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(pids)},process.pid+'\\n');setInterval(()=>fs.appendFileSync(${JSON.stringify(file)},'x'),10);process.on('SIGTERM',()=>process.stdout.write('GRANDCHILD_FINAL\\n',()=>process.exit(0)));`;
 const parent=`const fs=require('node:fs'),{spawn}=require('node:child_process');fs.appendFileSync(${JSON.stringify(pids)},process.pid+'\\n');const child=spawn(process.execPath,['-e',${JSON.stringify(writer)}],{stdio:['ignore','pipe','pipe']});child.stdout.pipe(process.stdout,{end:false});child.stderr.pipe(process.stderr,{end:false});setInterval(()=>{},1000);process.on('SIGTERM',()=>{child.kill('SIGTERM');child.once('close',()=>{${holdParent?'process.stdout.write("PARENT_HELD\\n");':'process.stdout.write("PARENT_FINAL\\n",()=>process.exit(0));'}});});`;
 return {file,pids,spec:{name:'BUILD',command:process.execPath,args:['-e',parent],cwd:directory,env:{},logDir:directory},bytes:()=>existsSync(file)?readFileSync(file).length:0};
};

test('old unregistered run-to-completion can keep BUILD descendants writing after supervisor stop',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'wsx-old-build-')),f=fixture(directory);
 const completed=runToCompletion(f.spec);
 try{
  await wait(()=>f.bytes()>2);const before=f.bytes();
  await Promise.resolve(); // The old stop only drains its empty API/Web registry.
  await sleep(50);assert(f.bytes()>before,'old BUILD remains active');
 }finally{
  if(existsSync(f.pids)){const [pid]=readFileSync(f.pids,'utf8').trim().split('\n').map(Number);process.kill(pid,'SIGTERM');}
  await completed;rmSync(directory,{recursive:true});
 }
});

test('owned BUILD cancellation drains parent and grandchild, blocks late starts and shares stop',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'wsx-owned-build-')),f=fixture(directory,true),signals=[];
 const registry=createOwnedOneShots({startManaged,killTree:(child,signal)=>{signals.push(signal);killTree(child,signal);},termMs:100,killMs:500}),job=registry.start(f.spec);
 const completion=job.completed().then(()=>({passed:true}),error=>({error}));
 try{
  await wait(()=>f.bytes()>2);assert.equal(readFileSync(f.pids,'utf8').trim().split('\n').length,2);
  const stopping=registry.stop();assert.equal(registry.stop(),stopping);
  assert.throws(()=>registry.start(f.spec),/ADMISSION_CLOSED/);
  await stopping;assert.equal(ownedGroupAlive(job.child.pid),false);assert.deepEqual(signals,['SIGTERM','SIGKILL']);
  assert.match((await completion).error.message,/CANCELLED/);
  const logPath=join(directory,'BUILD.log'),log=readFileSync(logPath);
  assert.match(log.toString(),/GRANDCHILD_FINAL\n/);assert.match(log.toString(),/PARENT_HELD\n/);
  const after=f.bytes();await sleep(60);assert.equal(f.bytes(),after,'no post-drain append');assert.deepEqual(readFileSync(logPath),log,'no late log writes after close and stream drain');
 }finally{await registry.stop();rmSync(directory,{recursive:true});}
});

test('one-shot completion retains final stdout and stderr before closing the owned log',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'wsx-final-build-log-'));
 const registry=createOwnedOneShots({startManaged,killTree,termMs:100,killMs:500});
 try{
  const tail='FINAL_STDOUT_'+ 'x'.repeat(32768),errorTail='FINAL_STDERR_'+ 'y'.repeat(32768);
  const job=registry.start({name:'BUILD',command:process.execPath,args:['-e',`process.stdout.write(${JSON.stringify(tail)},()=>process.stderr.write(${JSON.stringify(errorTail)},()=>process.exit(0)));`],cwd:directory,env:{},logDir:directory});
  assert.equal(await job.completed(),0);await registry.stop();
  const path=join(directory,'BUILD.log'),bytes=readFileSync(path);assert.equal(bytes.toString(),tail+errorTail);
  await sleep(50);assert.deepEqual(readFileSync(path),bytes);
 }finally{await registry.stop();rmSync(directory,{recursive:true});}
});

test('unconfirmed owned termination fails closed instead of proving cleanup',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'wsx-unconfirmed-build-')),f=fixture(directory);
 const registry=createOwnedOneShots({startManaged,killTree:()=>{},termMs:30,killMs:30}),job=registry.start(f.spec);
 const completion=job.completed().catch(()=>{});
 try{
  await wait(()=>f.bytes()>2);
  await assert.rejects(registry.stop(),/STOP_FAILED/);
  assert.equal(ownedGroupAlive(job.child.pid),true);
 }finally{
  killTree(job.child,'SIGTERM');await completion;
  await wait(()=>!ownedGroupAlive(job.child.pid));rmSync(directory,{recursive:true});
 }
});

test('owned log stream errors remain cleanup failure even when the child and group are gone',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'wsx-failed-build-log-'));
 const registry=createOwnedOneShots({startManaged,killTree,termMs:100,killMs:500});
 try{
  const job=registry.start({name:'BUILD',command:process.execPath,args:['-e',"process.stdout.write('private trailing output');"],cwd:directory,env:{},logDir:join(directory,'missing')});
  await assert.rejects(job.completed(),error=>error.code==='ENOENT');
  assert.equal(ownedGroupAlive(job.child.pid),false);
  await assert.rejects(registry.stop(),/STOP_FAILED/);
 }finally{rmSync(directory,{recursive:true});}
});
