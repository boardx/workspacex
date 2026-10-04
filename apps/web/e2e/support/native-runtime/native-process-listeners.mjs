import assert from 'node:assert/strict';
import {readFileSync,readdirSync,readlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

// Kernel socket inodes are the authority on Linux. Every matching listener must
// have an open descriptor in the exact managed process tree; foreign sockets fail.
export function linuxRuntimeListeners(pid,port,{read=readFileSync,list=readdirSync,link=readlinkSync,exec=execFileSync,descendsFrom}={}){
  assert(Number.isInteger(pid)&&pid>0);assert(Number.isInteger(port)&&port>0&&port<=65535);
  assert.equal(typeof descendsFrom,'function');
  const inodes=new Set();
  for(const protocol of ['tcp','tcp6']){
    const rows=read(`/proc/${pid}/net/${protocol}`,'utf8').trim().split('\n').slice(1);
    for(const row of rows){
      const fields=row.trim().split(/\s+/);assert(fields.length>=10,'complete kernel socket row required');
      const local=fields[1].split(':');assert(local.length===2&&/^[a-f0-9]{4}$/i.test(local[1]));
      if(fields[3]==='0A'&&parseInt(local[1],16)===port){assert(/^\d+$/.test(fields[9])&&fields[9]!=='0','live listening socket inode required');inodes.add(fields[9]);}
    }
  }
  assert(inodes.size>0,'kernel must report a listening socket');
  const parents=new Map();
  for(const row of exec('ps',['-eo','pid=,ppid='],{encoding:'utf8'}).trim().split('\n')){
    const values=row.trim().split(/\s+/).map(Number);assert(values.length===2&&values.every(Number.isInteger)&&values[0]>0&&values[1]>=0,'complete process ancestry required');parents.set(values[0],values[1]);
  }
  assert(parents.has(pid),'managed process must still exist in kernel ancestry');
  const owners=new Set(),observed=new Set();
  for(const candidate of parents.keys()){
    if(!descendsFrom(candidate,pid,parent=>parents.get(parent)))continue;
    for(const fd of list(`/proc/${candidate}/fd`)){
      let target;try{target=link(`/proc/${candidate}/fd/${fd}`);}catch(error){if(error.code==='ENOENT')continue;throw error;}
      const match=/^socket:\[(\d+)\]$/.exec(target);
      if(match&&inodes.has(match[1])){observed.add(match[1]);owners.add(candidate);}
    }
  }
  assert([...inodes].every(inode=>observed.has(inode)),'every kernel listener must belong to managed process tree');
  assert(owners.size>0,'owned listener required');return [...owners];
}
