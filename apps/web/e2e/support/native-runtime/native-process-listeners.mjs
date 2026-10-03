import assert from 'node:assert/strict';
import {readFileSync,readdirSync,readlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const stages=new Set(['READ_SOCKET_TABLE','PARSE_SOCKET_TABLE','SOCKET_PRESENT','READ_ANCESTRY','PARSE_ANCESTRY','MANAGED_PROCESS_PRESENT','LIST_DESCRIPTORS','PROBE_EXITED_DESCENDANT','READ_DESCRIPTOR','ALL_LISTENERS_OWNED','OWNED_LISTENER_PRESENT']);
const relations=new Set(['ROOT','DESCENDANT','UNKNOWN']);
const states=new Set(['R','S','D','T','t','Z','X','x','K','W','P','I','UNKNOWN']);
const causes=new Set(['ENOENT','ESRCH','EACCES','EPERM','ERR_ASSERTION','ERR_CHILD_PROCESS_STDIO_MAXBUFFER','UNKNOWN']);
export function parseNativeListenerFailure(value){
  assert(value&&typeof value==='object'&&!Array.isArray(value));
  const descriptors=Object.getOwnPropertyDescriptors(value);
  const keys=Object.keys(descriptors).sort();
  const extended=keys.length===5;
  assert.deepEqual(keys,extended?['cause','relation','stage','state','uidEqual']:['cause','stage']);
  assert(Object.values(descriptors).every(item=>Object.hasOwn(item,'value')));
  const stage=descriptors.stage.value,cause=descriptors.cause.value;
  assert(stages.has(stage)&&causes.has(cause));
  if(!extended)return{stage,cause};
  const relation=descriptors.relation.value,state=descriptors.state.value,uidEqual=descriptors.uidEqual.value;
  assert(relations.has(relation)&&states.has(state));assert(uidEqual===null||typeof uidEqual==='boolean');
  return{stage,cause,relation,state,uidEqual};
}

// Linux do_exit releases a task's files before EXIT_ZOMBIE. A zombie
// leader with live sibling threads is NOT sufficient: require one task only.
function ownedZombieSnapshot(candidate,root,parents,read,list){
 try{
  if(candidate===root)return null;
  const chain=[],seen=new Set();let current=candidate;
  while(current!==undefined&&!seen.has(current)&&parents.has(current)){
   seen.add(current);
   const raw=read(`/proc/${current}/stat`,'utf8');
   if(typeof raw!=='string'||raw.length>65536)return null;
   const close=raw.lastIndexOf(')'),open=raw.indexOf('(');
   if(open<1||close<=open||!/^\d+$/.test(raw.slice(0,open).trim())||Number(raw.slice(0,open).trim())!==current)return null;
   const fields=raw.slice(close+1).trim().split(/\s+/),state=fields[0],parent=Number(fields[1]),start=fields[19];
   if(fields.length<20||!/^\d+$/.test(fields[1]??'')||!Number.isSafeInteger(parent)||parent!==parents.get(current)||!/^\d+$/.test(start??'')||BigInt(start)<=0n)return null;
   if(current===candidate?state!=='Z':!['R','S','D','T','t','K','W','P','I'].includes(state))return null;
   chain.push({pid:current,parent,start});
   if(current===root)break;
   current=parent;
  }
  if(chain.at(-1)?.pid!==root)return null;
  const tasks=list(`/proc/${candidate}/task`);
  if(!Array.isArray(tasks)||tasks.length!==1||tasks[0]!==String(candidate))return null;
  return chain;
 }catch{return null;}
}

// Kernel socket inodes are the authority on Linux. Every matching listener must
// have an open descriptor in the exact managed process tree; foreign sockets fail.
export function linuxRuntimeListeners(pid,port,{read=readFileSync,list=readdirSync,link=readlinkSync,exec=execFileSync,kill=process.kill,descendsFrom}={}){
  assert(Number.isInteger(pid)&&pid>0);assert(Number.isInteger(port)&&port>0&&port<=65535);
  assert.equal(typeof descendsFrom,'function');
  let stage='READ_SOCKET_TABLE';
  let diagnostic={relation:'UNKNOWN',state:'UNKNOWN',uidEqual:null};
  try{
  const inodes=new Set();
  for(const protocol of ['tcp','tcp6']){
    stage='READ_SOCKET_TABLE';const rows=read(`/proc/${pid}/net/${protocol}`,'utf8').trim().split('\n').slice(1);
    stage='PARSE_SOCKET_TABLE';for(const row of rows){
      const fields=row.trim().split(/\s+/);assert(fields.length>=10,'complete kernel socket row required');
      const local=fields[1].split(':');assert(local.length===2&&/^[a-f0-9]{4}$/i.test(local[1]));
      if(fields[3]==='0A'&&parseInt(local[1],16)===port){assert(/^\d+$/.test(fields[9])&&fields[9]!=='0','live listening socket inode required');inodes.add(fields[9]);}
    }
  }
  stage='SOCKET_PRESENT';assert(inodes.size>0,'kernel must report a listening socket');
  const parents=new Map();
  stage='READ_ANCESTRY';const ancestry=exec('ps',['-eo','pid=,ppid='],{encoding:'utf8'}).trim().split('\n');
  stage='PARSE_ANCESTRY';for(const row of ancestry){
    const values=row.trim().split(/\s+/).map(Number);assert(values.length===2&&values.every(Number.isInteger)&&values[0]>0&&values[1]>=0,'complete process ancestry required');parents.set(values[0],values[1]);
  }
  stage='MANAGED_PROCESS_PRESENT';assert(parents.has(pid),'managed process must still exist in kernel ancestry');
  const owners=new Set(),observed=new Set();
  for(const candidate of parents.keys()){
    if(!descendsFrom(candidate,pid,parent=>parents.get(parent)))continue;
    diagnostic={relation:'UNKNOWN',state:'UNKNOWN',uidEqual:null};
    const zombieBefore=ownedZombieSnapshot(candidate,pid,parents,read,list);
    let descriptors;stage='LIST_DESCRIPTORS';
    try{descriptors=list(`/proc/${candidate}/fd`);}catch(error){
      // Only this already-proven descendant is observed. These facts never
      // supply ownership or replace the primary failure. Only the separate,
      // repeated single-task zombie proof below can exclude this denied PID.
      diagnostic={relation:candidate===pid?'ROOT':'DESCENDANT',state:'UNKNOWN',uidEqual:null};
      try{
        const status=read(`/proc/${candidate}/status`,'utf8');
        if(typeof status==='string'&&status.length<=65536){
          const state=/^State:\s+([A-Za-z])(?:\s|$)/m.exec(status)?.[1];
          if(states.has(state))diagnostic.state=state;
          const uid=/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/m.exec(status);
          if(uid&&uid.slice(1).every(value=>Number.isSafeInteger(Number(value)))&&typeof process.geteuid==='function')diagnostic.uidEqual=Number(uid[2])===process.geteuid();
        }
      }catch{}
      if(Object.getOwnPropertyDescriptor(error,'code')?.value==='EACCES'&&diagnostic.state==='Z'&&diagnostic.uidEqual===true&&zombieBefore){
        const zombieAfter=ownedZombieSnapshot(candidate,pid,parents,read,list);
        if(zombieAfter&&JSON.stringify(zombieBefore)===JSON.stringify(zombieAfter)){
          diagnostic={relation:'UNKNOWN',state:'UNKNOWN',uidEqual:null};continue;
        }
      }
      // ps is a snapshot. Only a demonstrably exited non-root descendant may
      // disappear between that snapshot and fd enumeration. Its descriptors
      // never supply ownership; every required inode still needs live proof.
      if(Object.getOwnPropertyDescriptor(error,'code')?.value!=='ENOENT'||candidate===pid)throw error;
      stage='PROBE_EXITED_DESCENDANT';
      try{kill(candidate,0);}catch(probe){if(Object.getOwnPropertyDescriptor(probe,'code')?.value==='ESRCH'){diagnostic={relation:'UNKNOWN',state:'UNKNOWN',uidEqual:null};continue;}throw probe;}
      throw error;
    }
    for(const fd of descriptors){
      stage='READ_DESCRIPTOR';
      let target;try{target=link(`/proc/${candidate}/fd/${fd}`);}catch(error){if(Object.getOwnPropertyDescriptor(error,'code')?.value==='ENOENT')continue;throw error;}
      const match=/^socket:\[(\d+)\]$/.exec(target);
      if(match&&inodes.has(match[1])){observed.add(match[1]);owners.add(candidate);}
    }
  }
  diagnostic={relation:'UNKNOWN',state:'UNKNOWN',uidEqual:null};
  stage='ALL_LISTENERS_OWNED';assert([...inodes].every(inode=>observed.has(inode)),'every kernel listener must belong to managed process tree');
  stage='OWNED_LISTENER_PRESENT';assert(owners.size>0,'owned listener required');return [...owners];
  }catch(cause){
    const code=Object.getOwnPropertyDescriptor(cause??{},'code')?.value;
    const error=new Error('NATIVE_LISTENER_PROBE_FAILED',{cause});
    error.nativeListenerFailure={stage,cause:causes.has(code)?code:'UNKNOWN',...diagnostic};throw error;
  }
}
