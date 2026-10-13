'use strict';
// Observe only Next's fixed dev-server fork. No restart, signal or argv changes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const cp=require('node:child_process'),{performance}=require('node:perf_hooks');
const memory=require('./next-memory-sample.cjs');
const web=path.resolve(__dirname,'../../../apps/web');
const cli=require.resolve('next/dist/bin/next',{paths:[web]});
const worker=require.resolve('next/dist/server/lib/start-server',{paths:[web]});
function need(v){if(!v)throw Error('CN_NEXT_WORKER_OBSERVER');}
function identity(pid){const s=fs.readFileSync(`/proc/${pid}/stat`,'utf8');const relative=fs.readFileSync(`/proc/${pid}/cgroup`,'utf8').trim().split('\n').find(v=>v.startsWith('0::'))?.slice(3);need(relative&&relative.startsWith('/')&&!relative.split('/').includes('..'));const p=path.join('/sys/fs/cgroup',relative),st=fs.lstatSync(p);need(st.isDirectory()&&!st.isSymbolicLink());return {pid,startTicks:s.slice(s.lastIndexOf(')')+2).split(' ')[19],cgroup:{inode:st.ino,device:st.dev,pathSha256:crypto.createHash('sha256').update(p).digest('hex')}};}
function store(directory,name,value){const fd=fs.openSync(path.join(directory,name),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
if(process.argv[1]===cli&&process.env.CN_RELEASE_FULLSTACK_FIXTURE==='1'){
 const directory=path.dirname(process.env.CN_SIX_REPORT_PATH||'');need(path.isAbsolute(directory)&&fs.realpathSync(directory)===directory);const st=fs.lstatSync(directory);need(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&(st.mode&0o777)===0o700);
 const original=cp.fork;let sequence=0;
 cp.fork=function(modulePath,...rest){
  const child=Reflect.apply(original,this,[modulePath,...rest]);
  if(modulePath!==worker)return child;
  const options=rest.find(v=>v&&typeof v==='object'&&!Array.isArray(v));const values=String(options?.env?.NODE_OPTIONS||'').match(/--max-old-space-size=(\d+)/g)||[];
  const heapMiB=values.length===1?Number(values[0].split('=')[1]):null;const index=++sequence,forkedAt=new Date().toISOString(),at=performance.now();
  // Next may restart its own worker; retain only a bounded observation sequence.
  if(index>4)return child;
  const memorySnapshot=memory.collect(child);
  let started=null;
  child.on('spawn',()=>{try{started=identity(child.pid);}catch{}});
  child.on('exit',(exitCode,signal)=>{try{const after=fs.lstatSync(directory);need(after.ino===st.ino&&after.dev===st.dev);store(directory,`next-worker-${index}.json`,{kind:'cn-next-worker-exit-v1',forkedAt,exitedAt:new Date().toISOString(),elapsedMilliseconds:Number((performance.now()-at).toFixed(3)),workerPathSha256:crypto.createHash('sha256').update(worker).digest('hex'),process:started,heapMiB,exitCode,signal:['SIGKILL','SIGTERM','SIGINT','SIGABRT','SIGSEGV','SIGBUS'].includes(signal)?signal:null,memory:memorySnapshot()});}catch{}});
  return child;
 };
}
if(process.argv[1]===worker&&process.env.CN_RELEASE_FULLSTACK_FIXTURE==='1'){
 try{const directory=path.dirname(process.env.CN_SIX_REPORT_PATH||'');need(path.isAbsolute(directory)&&fs.realpathSync(directory)===directory);const st=fs.lstatSync(directory);need(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&(st.mode&0o777)===0o700);store(directory,'next-worker-runtime.json',{kind:'cn-next-worker-runtime-v1',observedAt:new Date().toISOString(),process:identity(process.pid),heapSizeLimitBytes:require('node:v8').getHeapStatistics().heap_size_limit});memory.startSampler();}catch{}
}
module.exports={identity};
