/* Process ownership for this one opt-in experiment, not an application process manager. */
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const core=require('./chat-refresh-diagnostic-core.cjs');
const scopeHash=id=>crypto.createHash('sha256').update(id).digest('hex');
const valid=n=>Number.isSafeInteger(n)&&n>1;
const alive=id=>{try{process.kill(id,0);return true;}catch(e){return e.code!=='ESRCH';}};
function signal(id,value){try{process.kill(id,value);}catch(e){if(e.code!=='ESRCH')throw Error('owned_process_signal_failed');}}
function starts(directory,scope){
 const rows=[];
 for(const name of fs.readdirSync(directory).filter(n=>n.endsWith('-launcher.jsonl')||n==='production-build.jsonl')){
  const file=path.join(directory,name),st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>1048576)throw Error('owned_manifest_invalid');
  for(const line of fs.readFileSync(file,'utf8').split('\n').filter(Boolean)){
   const r=JSON.parse(line);if(!['owned-start','child-start'].includes(r.event)||r.scopeHash!==scope)continue;
   if(!valid(r.pgid)||!valid(r.ownerPid))throw Error('owned_manifest_invalid');rows.push(r);
  }
 }
 return rows;
}
function remaining(directory,scope){
 const rows=starts(directory,scope);
 return {observed:rows.length,groups:[...new Set(rows.map(r=>r.pgid))].filter(id=>alive(-id)),owners:[...new Set(rows.map(r=>r.ownerPid))].filter(id=>id!==process.pid&&alive(id))};
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitGone(directory,scope,budget){const end=Date.now()+budget;for(;;){const r=remaining(directory,scope);if(!r.groups.length&&!r.owners.length)return r;if(Date.now()>=end)return r;await sleep(25);}}
function killRecorded(directory,scope,value){const r=remaining(directory,scope);for(const id of r.groups)signal(-id,value);for(const id of r.owners)signal(id,value);return r;}
async function cleanupOwned(directory,scope,note){
 let r=remaining(directory,scope);if(!r.groups.length&&!r.owners.length){note('owned-cleanup',r);return;}
 note('owned-cleanup-term',r);killRecorded(directory,scope,'SIGTERM');r=await waitGone(directory,scope,3500);
 if(r.groups.length||r.owners.length){note('owned-cleanup-kill',r);killRecorded(directory,scope,'SIGKILL');r=await waitGone(directory,scope,2000);}
 note('owned-cleanup',r);if(r.groups.length||r.owners.length)throw Error('owned_process_cleanup_incomplete');
}
async function runOwned(command,args,options){
 const {cwd,env,directory,scope,purpose,note,budgetMs,graceMs=3000}=options;
 return new Promise(resolve=>{
  const build=purpose==='build';
  const child=spawn(command,args,{cwd,env,detached:true,stdio:build?['ignore','pipe','pipe']:'inherit'});
  if(!child.pid){child.once('error',()=>resolve({code:1,interrupted:false}));return;}
  note('owned-start',{scopeHash:scope,ownerPid:process.pid,pid:child.pid,pgid:child.pid,purpose});
  if(build)for(const stream of [child.stdout,child.stderr]){let pending='';stream.on('data',chunk=>{pending+=chunk.toString();const lines=pending.split('\n');pending=lines.pop().slice(-4096);for(const line of lines){const safe=core.safeChildLine(line);if(safe)note(safe.event,safe);}});}
  let interrupted=false,expired=false,escalation;
  const stop=()=>{if(interrupted)return;interrupted=true;note('owned-stop',{pgid:child.pid,signal:build?'SIGTERM':'SIGINT'});signal(-child.pid,build?'SIGTERM':'SIGINT');escalation=setTimeout(()=>{note('owned-kill',{pgid:child.pid});signal(-child.pid,'SIGKILL');},graceMs);};
  const exit=()=>signal(-child.pid,'SIGKILL');
  for(const s of ['SIGTERM','SIGINT','SIGHUP','SIGQUIT'])process.once(s,stop);process.once('exit',exit);
  const deadline=budgetMs?setTimeout(()=>{expired=true;stop();},budgetMs):undefined;
  child.once('error',()=>{interrupted=true;});
  child.once('close',code=>{
   clearTimeout(deadline);clearTimeout(escalation);for(const s of ['SIGTERM','SIGINT','SIGHUP','SIGQUIT'])process.off(s,stop);process.off('exit',exit);
   signal(-child.pid,'SIGKILL');note('owned-exit',{pgid:child.pid,code,expired,interrupted});resolve({code:expired?124:code??1,interrupted});
  });
 });
}
function claimDist(output){if(fs.existsSync(output))throw Error('fresh isolated production dist required');fs.mkdirSync(output,{mode:0o700});return fs.lstatSync(output);}
module.exports={scopeHash,starts,remaining,cleanupOwned,killRecorded,runOwned,claimDist};
if(require.main===module){
 const directory=path.resolve('apps/web/e2e/__evidence__/chat-refresh-diagnostics');
 const entry=fs.readFileSync(path.join(directory,'production-build.jsonl'),'utf8').split('\n').filter(Boolean).map(JSON.parse).find(r=>r.event==='comparison-start');
 if(!entry||!/^[a-f0-9]{64}$/.test(entry.scopeHash))throw Error('owned_scope_proof_missing');
 const proof=remaining(directory,entry.scopeHash);console.log(JSON.stringify({event:'external-owned-proof',...proof}));
 if(!proof.observed||proof.groups.length||proof.owners.length)process.exitCode=1;
}
