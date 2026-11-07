'use strict';
// Read-only fixture observation. No signal, restart, retry or budget change.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const cp=require('node:child_process');
const {resources,proc,store}=require('./next-server-launch.cjs');
function kernelOom(pid,since,bounds){
 if(process.platform!=='linux')return {available:false,reason:'LINUX_REQUIRED'};
 const result=cp.spawnSync('dmesg',['--since',since.slice(0,19).replace('T',' ')],{encoding:'utf8',timeout:2000,maxBuffer:65536,env:{PATH:process.env.PATH,LANG:'C',TZ:'UTC'}});
 if(result.error||result.status!==0)return {available:false,reason:'KERNEL_LOG_UNAVAILABLE'};
 return parseKernelOom(result.stdout,pid,bounds);
}
function parseKernelOom(stdout,pid,bounds){
 const pattern=new RegExp('\\bKilled process '+pid+' \\(');
 const matches=stdout.split('\n').filter(line=>pattern.test(line)&&/out of memory/i.test(line)&&withinWindow(line,bounds));
 return {available:true,ownedPid:pid,kernelOomKillConfirmed:matches.length>0,matchingRecords:matches.length,kernelMonotonicSeconds:matches.map(line=>line.match(/^\[\s*([0-9.]+)\]/)?.[1]??null)};
}
function withinWindow(line,bounds){
 if(!bounds)return true;
 const time=line.match(/^\[\s*(\d+)(?:\.(\d+))?\]/);
 if(!time)return false;
 const ns=BigInt(time[1])*1000000000n+BigInt((time[2]||'').padEnd(9,'0').slice(0,9));
 return ns>=BigInt(bounds.startedNs)&&ns<=BigInt(bounds.exitedNs);
}
function delta(before,after){
 const rows=[];
 for(const end of after.observations||[]){
  const start=(before.observations||[]).find(v=>v.inode===end.inode&&v.device===end.device&&v.pathSha256===end.pathSha256);
  if(start&&start.events&&end.events)rows.push({pathSha256:end.pathSha256,oom:Number(end.events.oom)-Number(start.events.oom),oomKill:Number(end.events.oom_kill)-Number(start.events.oom_kill),memoryMaxBytes:end['memory.max']??null});
 }
 return rows;
}
function install({server,directory,readResources=resources,readKernel=kernelOom}){
 const st=fs.lstatSync(directory);
 if(!st.isDirectory()||st.isSymbolicLink()||fs.realpathSync(directory)!==directory||st.uid!==process.getuid()||(st.mode&0o777)!==0o700)throw Error('CN_NEXT_WORKER_DIRECTORY');
 const original=cp.fork;let sequence=0;
 const snapshot=()=>{try{return readResources();}catch{return {available:false,reason:'RESOURCE_READBACK_UNAVAILABLE'};}};
 const sourceSha256=crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
 const moduleSha256=crypto.createHash('sha256').update(fs.readFileSync(server)).digest('hex');
 function save(name,value){try{const now=fs.lstatSync(directory);if(now.ino!==st.ino||now.dev!==st.dev)throw Error();store(directory,name,value);}catch{process.stderr.write('CN_NEXT_WORKER_OBSERVATION_UNAVAILABLE\n');}}
 function wrapped(modulePath,...args){
  const child=original.call(this,modulePath,...args);
  if(modulePath!==server)return child;
  sequence++;
  if(sequence>16){if(sequence===17)save('next-worker-overflow.json',{kind:'cn-next-worker-overflow-v1',limit:16});return child;}
  const startedNs=process.hrtime.bigint().toString();
  const prefix='next-worker-'+String(sequence).padStart(2,'0'),occurredAt=new Date().toISOString(),before=snapshot();
  const worker=proc(child.pid)||{pid:child.pid,startTicks:null};let maxObservedRssPages=worker.rssPages===undefined?null:Number(worker.rssPages);
  const identity={kind:'cn-next-worker-observation-v1',sourceSha256,moduleSha256,sequence,cliPid:process.pid,worker};
  child.once('spawn',()=>save(prefix+'-started.json',{...identity,phase:'spawned',occurredAt,monotonicNs:process.hrtime.bigint().toString(),resources:before}));
  const timer=setInterval(()=>{const current=proc(child.pid);if(current&&current.startTicks===worker.startTicks)maxObservedRssPages=Math.max(maxObservedRssPages??0,Number(current.rssPages)||0);},500);timer.unref();
  child.once('exit',(code,signal)=>{
   const exitedNs=process.hrtime.bigint().toString();
   clearInterval(timer);const after=snapshot(),oomDelta=delta(before,after);
   let kernel={available:false,reason:'NO_CORRELATED_OOM_KILL'};
   if(signal==='SIGKILL'&&oomDelta.some(v=>v.oomKill>0)){try{kernel=readKernel(child.pid,occurredAt,{startedNs,exitedNs});}catch{kernel={available:false,reason:'KERNEL_LOG_UNAVAILABLE'};}}
   save(prefix+'-exit.json',{...identity,phase:'exited',occurredAt:new Date().toISOString(),monotonicNs:process.hrtime.bigint().toString(),startedNs,exitedNs,exitCode:code,signal,maxObservedRssPages,rssSampleIntervalMs:500,resources:after,oomDelta,kernel});
  });
  child.once('error',()=>{clearInterval(timer);save(prefix+'-error.json',{...identity,phase:'spawn-error'});});
  return child;
 }
 cp.fork=wrapped;
 return ()=>{if(cp.fork===wrapped)cp.fork=original;};
}
// The preload is inherited by the worker, but only the fixed Next CLI hooks fork.
if(process.env.CN_RELEASE_FULLSTACK_FIXTURE==='1'&&process.env.CN_SIX_REPORT_PATH){
 const web=path.resolve(__dirname,'../../../apps/web'),cli=require.resolve('next/dist/bin/next',{paths:[web]});
 if(process.argv[1]&&fs.realpathSync(process.argv[1])===fs.realpathSync(cli))install({server:require.resolve('next/dist/server/lib/start-server',{paths:[web]}),directory:path.dirname(process.env.CN_SIX_REPORT_PATH)});
}
module.exports={install,delta,kernelOom,parseKernelOom};
