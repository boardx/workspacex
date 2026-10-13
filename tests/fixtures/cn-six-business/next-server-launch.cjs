'use strict';
// No new session, retry, restart, or business budget; original output is forwarded.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const web=path.resolve(__dirname,'../../../apps/web');
const cli=require.resolve('next/dist/bin/next',{paths:[web]});
function need(v){if(!v)throw Error('CN_NEXT_LAUNCH_CONTRACT');}
function proc(pid){try{const s=fs.readFileSync(`/proc/${pid}/stat`,'utf8');return {pid,startTicks:s.slice(s.lastIndexOf(')')+2).split(' ')[19]};}catch{return null;}}
function resources(){
 if(process.platform!=='linux')return {available:false};
 try{
  const rows=fs.readFileSync('/proc/self/cgroup','utf8').trim().split('\n').filter(s=>s.startsWith('0::'));need(rows.length===1);
  const relative=rows[0].slice(3);need(relative.startsWith('/')&&!relative.split('/').includes('..'));
  let current=path.join('/sys/fs/cgroup',relative);const observations=[];
  for(let i=0;i<8&&current!=='/sys/fs/cgroup';i++,current=path.dirname(current)){
   const st=fs.lstatSync(current);need(st.isDirectory()&&!st.isSymbolicLink());
   const value={inode:st.ino,device:st.dev,pathSha256:crypto.createHash('sha256').update(current).digest('hex')};
   for(const name of ['memory.current','memory.peak','memory.max','memory.events']){
    const raw=fs.readFileSync(path.join(current,name),'utf8');need(raw.length<4096);
    if(name==='memory.events'){value.events={};for(const line of raw.trim().split('\n')){const [key,n]=line.split(' ');if(['low','high','max','oom','oom_kill','oom_group_kill'].includes(key)){need(/^\d+$/.test(n));value.events[key]=n;}}}
    else{need(/^(\d+|max)\s*$/.test(raw));value[name]=raw.trim();}
   }
   const after=fs.lstatSync(current);need(after.ino===st.ino&&after.dev===st.dev);observations.push(value);
  }
  return {available:true,observations};
 }catch{return {available:false,reason:'RESOURCE_READBACK_UNAVAILABLE'};}
}
function store(directory,name,value){
 const fd=fs.openSync(path.join(directory,name),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const d=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
}
async function main(){
 const args=process.argv.slice(2);
 if(args.length===1&&args[0]==='--version'){const child=spawn(process.execPath,[cli,'--version'],{cwd:web,stdio:'inherit'});child.on('exit',code=>{process.exitCode=code??1;});return;}
 need(args.length===1&&/^\d+$/.test(args[0])&&Number(args[0])>0&&Number(args[0])<65536);
 need(process.env.CN_RELEASE_FULLSTACK_FIXTURE==='1'&&process.env.CN_SIX_REPORT_PATH);
 const directory=path.dirname(process.env.CN_SIX_REPORT_PATH);need(path.isAbsolute(directory)&&fs.realpathSync(directory)===directory);
 const st=fs.lstatSync(directory);need(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&(st.mode&0o777)===0o700);
 const identity={kind:'cn-next-launch-v1',sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),port:Number(args[0])};
 store(directory,'next-launch-intent.json',identity);
 const child=spawn(process.execPath,['--require',path.join(__dirname,'next-worker-observer.cjs'),cli,'dev','-p',args[0]],{cwd:web,env:process.env,stdio:['ignore','pipe','pipe'],detached:false});
 const counts={stdout:0,stderr:0},hashes={stdout:crypto.createHash('sha256'),stderr:crypto.createHash('sha256')};
 for(const key of ['stdout','stderr']){child[key].on('data',data=>{counts[key]+=data.length;hashes[key].update(data);if(!process[key].write(data))child[key].pause();});process[key].on('drain',()=>child[key].resume());}
 const before=resources();let started=false;
 child.on('spawn',()=>{try{store(directory,'next-launch-started.json',{...identity,process:proc(child.pid),resources:before});started=true;}catch{child.kill('SIGTERM');}});
 const relay=signal=>{if(child.exitCode===null&&child.signalCode===null)child.kill(signal);};
 process.on('SIGTERM',relay.bind(null,'SIGTERM'));process.on('SIGINT',relay.bind(null,'SIGINT'));
 child.on('error',()=>{process.exitCode=1;});
 child.on('close',(code,signal)=>{
  try{const after=fs.lstatSync(directory);need(after.ino===st.ino&&after.dev===st.dev);store(directory,'next-launch-exit.json',{...identity,started,exitCode:code,signal:signal&&['SIGKILL','SIGTERM','SIGINT','SIGABRT','SIGSEGV','SIGBUS'].includes(signal)?signal:null,resources:resources(),output:{stdoutBytes:counts.stdout,stderrBytes:counts.stderr,stdoutSha256:hashes.stdout.digest('hex'),stderrSha256:hashes.stderr.digest('hex')}});}catch{process.exitCode=1;return;}
  process.exitCode=code??(signal==='SIGKILL'?137:signal==='SIGTERM'?143:1);
 });
}
if(require.main===module)main().catch(()=>{console.error('CN_NEXT_LAUNCH_CONTRACT');process.exitCode=1;});
module.exports={resources,proc,main};
