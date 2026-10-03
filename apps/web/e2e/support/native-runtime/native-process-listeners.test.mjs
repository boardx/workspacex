import {test} from 'node:test';
import assert from 'node:assert/strict';
import {linuxRuntimeListeners,parseNativeListenerFailure} from './native-process-listeners.mjs';
import {descendsFrom} from './runtime-attestation.mjs';
const row=(port,inode,state='0A')=>`0: 0100007F:${port.toString(16).padStart(4,'0')} 00000000:0000 ${state} 0:0 0:0 0 1000 0 ${inode}`;
function fixture({rows=[row(1234,'77')],parents='100 1\n101 100\n999 1',fds={'100':['/owned/file'],'101':['socket:[77]']}}={}){
  const paths=[];
  return {paths,descendsFrom,read:(path)=>{paths.push(path);return `header\n${path.endsWith('/tcp')?rows.join('\n'):''}\n`;},exec:(command,args)=>{assert.equal(command,'ps');assert.deepEqual(args,['-eo','pid=,ppid=']);return parents;},list:(path)=>{paths.push(path);const pid=path.split('/')[2];assert.notEqual(pid,'999','foreign process descriptors must not be inspected');return (fds[pid]??[]).map((_,i)=>String(i));},link:path=>{const parts=path.split('/');return fds[parts[2]][Number(parts[4])];}};
}
test('exact listening inode must have an owned descendant descriptor and retain ancestry gate',()=>{
  const deps=fixture();assert.deepEqual(linuxRuntimeListeners(100,1234,deps),[101]);
  assert(deps.paths.includes('/proc/100/net/tcp'));assert(deps.paths.includes('/proc/100/net/tcp6'));
  assert.deepEqual(linuxRuntimeListeners(100,1234,fixture({rows:[row(9999,'88'),row(1234,'77','01'),row(1234,'77')]})),[101]);
});
test('no socket, foreign socket, partial ownership and unrelated PID cannot pass',()=>{
  for(const deps of [fixture({rows:[]}),fixture({fds:{'100':[],'101':[]}}),fixture({rows:[row(1234,'77'),row(1234,'88')]}),fixture({parents:'101 100\n999 1'})])assert.throws(()=>linuxRuntimeListeners(100,1234,deps));
  for(const deps of [fixture({parents:'100 1\n101 999\n999 1'}),fixture({rows:[row(1234,'0')]}),fixture({rows:['malformed']})])assert.throws(()=>linuxRuntimeListeners(100,1234,deps));
});
test('permission failures retain actual cause and never substitute root or lsof',()=>{
  for(const operation of ['read','list','link','exec'])for(const code of ['EACCES','EPERM']){
    const error=Object.assign(new Error('private kernel cause'),{code}),deps=fixture();deps[operation]=()=>{throw error;};
    assert.throws(()=>linuxRuntimeListeners(100,1234,deps),actual=>actual.cause===error);
  }
  for(const pid of [0,-1,NaN,1.5,'100'])assert.throws(()=>linuxRuntimeListeners(pid,1234,fixture()));
  for(const port of [0,-1,65536,1.5,'1234'])assert.throws(()=>linuxRuntimeListeners(100,port,fixture()));
});
test('closed descriptor races cannot create ownership or hide a foreign listener',()=>{
  const deps=fixture();deps.link=()=>{throw Object.assign(new Error('closed fd'),{code:'ENOENT'});};
  assert.throws(()=>linuxRuntimeListeners(100,1234,deps),actual=>actual.nativeListenerFailure.stage==='ALL_LISTENERS_OWNED');
});
test('IPv6 listener inode requires the same exact owned descriptor proof',()=>{
  const deps=fixture();deps.read=path=>`header\n${path.endsWith('/tcp6')?row(1234,'77'):''}\n`;
  assert.deepEqual(linuxRuntimeListeners(100,1234,deps),[101]);
});
test('all matching socket inodes may belong to distinct owned child processes',()=>{
  const deps=fixture({rows:[row(1234,'77'),row(1234,'88')],parents:'100 1\n101 100\n102 100',fds:{'100':[],'101':['socket:[77]'],'102':['socket:[88]']}});
  assert.deepEqual(linuxRuntimeListeners(100,1234,deps),[101,102]);
});
test('cyclic foreign ancestry cannot acquire ownership of a listener',()=>{
  assert.throws(()=>linuxRuntimeListeners(100,1234,fixture({parents:'100 1\n101 102\n102 101'})),actual=>actual.nativeListenerFailure.stage==='ALL_LISTENERS_OWNED');
});

test('exited snapshot descendants cannot invalidate live owned socket proof',()=>{
 const deps=fixture({parents:'100 1\n101 100\n102 100'}),original=deps.list,probes=[];
 deps.list=path=>{if(path==='/proc/102/fd')throw Object.assign(new Error('private exited child'),{code:'ENOENT'});return original(path);};
 deps.kill=(pid,signal)=>{probes.push([pid,signal]);throw Object.assign(new Error('gone'),{code:'ESRCH'});};
 assert.deepEqual(linuxRuntimeListeners(100,1234,deps),[101]);assert.deepEqual(probes,[[102,0]]);
});
test('missing live descriptors, managed root and inaccessible descendants remain blocked',()=>{
 for(const candidate of [100,102])for(const code of ['ENOENT','EACCES','EPERM','PRIVATE']){
  const deps=fixture({parents:'100 1\n101 100\n102 100'}),original=deps.list;let probes=0;
  deps.list=path=>{if(path===`/proc/${candidate}/fd`)throw Object.assign(new Error('private path'),{code});return original(path);};
  deps.kill=()=>{probes++;};
  assert.throws(()=>linuxRuntimeListeners(100,1234,deps),error=>error.nativeListenerFailure.cause===(code==='PRIVATE'?'UNKNOWN':code));
  assert.equal(probes,candidate!==100&&code==='ENOENT'?1:0);
 }
 for(const code of ['EPERM','EACCES','UNKNOWN']){
  const deps=fixture({parents:'100 1\n101 100\n102 100'}),original=deps.list;
  deps.list=path=>{if(path==='/proc/102/fd')throw Object.assign(new Error('private'),{code:'ENOENT'});return original(path);};
  deps.kill=()=>{throw Object.assign(new Error('private probe'),{code});};
  assert.throws(()=>linuxRuntimeListeners(100,1234,deps),error=>error.nativeListenerFailure.stage==='PROBE_EXITED_DESCENDANT');
 }
});
test('gone owner cannot supply a required socket inode or hide partial ownership',()=>{
 for(const rows of [[row(1234,'77')],[row(1234,'77'),row(1234,'88')]]){
  const deps=fixture({rows,parents:'100 1\n101 100\n102 100',fds:{'100':[],'101':rows.length===2?['socket:[77]']:[]}}),original=deps.list;
  deps.list=path=>{if(path==='/proc/102/fd')throw Object.assign(new Error('gone'),{code:'ENOENT'});return original(path);};
  deps.kill=()=>{throw Object.assign(new Error('gone'),{code:'ESRCH'});};
  assert.throws(()=>linuxRuntimeListeners(100,1234,deps),error=>error.nativeListenerFailure.stage==='ALL_LISTENERS_OWNED');
 }
});
test('probe failure exports only a fixed stage and code while retaining original cause',()=>{
 const deps=fixture(),original=Object.assign(new Error('private kernel path'),{code:'PRIVATE_CODE'});deps.read=()=>{throw original;};
 assert.throws(()=>linuxRuntimeListeners(100,1234,deps),error=>{
  assert.equal(error.cause,original);assert.deepEqual(error.nativeListenerFailure,{stage:'READ_SOCKET_TABLE',cause:'UNKNOWN',relation:'UNKNOWN',state:'UNKNOWN',uidEqual:null});
  assert.ok(!JSON.stringify(error.nativeListenerFailure).includes('private'));return true;
 });
});

const ancestry=(pid,root,parent)=>{const seen=new Set();while(pid>1&&!seen.has(pid)){if(pid===root)return true;seen.add(pid);pid=parent(pid);}return false;};
function failure(candidate,status){
  const paths=[];const error=Object.assign(new Error('private denial'),{code:'EACCES'});
  const deps={descendsFrom:ancestry,exec:()=> '100 1\n101 100\n999 1',
    read:path=>{paths.push(path);if(path.endsWith('/status')){if(status instanceof Error)throw status;return status;}return `header\n${path.endsWith('/tcp')?'0: 0100007F:04D2 00000000:0000 0A 0:0 0:0 0 1000 0 77':''}\n`;},
    list:path=>{const pid=Number(path.split('/')[2]);assert.notEqual(pid,999);if(pid===candidate)throw error;return ['0'];},link:()=> 'socket:[77]'};
  try{linuxRuntimeListeners(100,1234,deps);assert.fail('denial must never pass');}catch(actual){assert.equal(actual.cause,error);return {details:parseNativeListenerFailure(actual.nativeListenerFailure),paths};}
}
test('owned root/descendant diagnostic retains primary denial and exports only enum/boolean facts',()=>{
  for(const candidate of [100,101]){
    const {details,paths}=failure(candidate,`Name:\tprivate secret\nState:\tZ (zombie)\nUid:\t${process.geteuid()}\t${process.geteuid()}\t${process.geteuid()}\t${process.geteuid()}\n`);
    assert.deepEqual(details,{stage:'LIST_DESCRIPTORS',cause:'EACCES',relation:candidate===100?'ROOT':'DESCENDANT',state:'Z',uidEqual:true});
    assert(paths.includes(`/proc/${candidate}/status`));assert(!paths.some(path=>path.includes('/999/')));assert(!JSON.stringify(details).includes('private'));
  }
});
test('unavailable/oversized/malformed owned status remains UNKNOWN and hard blocked',()=>{
  for(const status of [new Error('private read denial'),'State: secret\nUid: x\n','x'.repeat(65537)]){
    assert.deepEqual(failure(101,status).details,{stage:'LIST_DESCRIPTORS',cause:'EACCES',relation:'DESCENDANT',state:'UNKNOWN',uidEqual:null});
  }
});
test('uid comparison false is diagnostic only and never exempts denied descriptors',()=>{
  assert.equal(failure(101,'State:\tS (sleeping)\nUid:\t999999\t999999\t999999\t999999\n').details.uidEqual,false);
});
test('decoder rejects unknown fields, private strings and accessors without evaluation; legacy remains valid',()=>{
  const good={stage:'LIST_DESCRIPTORS',cause:'EACCES',relation:'ROOT',state:'S',uidEqual:null};
  assert.deepEqual(parseNativeListenerFailure({stage:'LIST_DESCRIPTORS',cause:'EACCES'}),{stage:'LIST_DESCRIPTORS',cause:'EACCES'});
  for(const bad of [{...good,pid:100},{...good,path:'/private'},{...good,relation:'private'},{...good,state:'private'},{...good,uidEqual:100}])assert.throws(()=>parseNativeListenerFailure(bad));
  let reads=0;const accessor={...good};Object.defineProperty(accessor,'state',{get(){reads++;return 'S';},enumerable:true});assert.throws(()=>parseNativeListenerFailure(accessor));assert.equal(reads,0);
});
test('a safely skipped gone child cannot label a later descriptor failure or missing inode',()=>{
  for(const laterFailure of [true,false]){
    const deps={descendsFrom:ancestry,exec:()=> '100 1\n101 100\n102 100',
      read:path=>path.endsWith('/status')?`State:\tZ (zombie)\nUid:\t${process.geteuid()}\t${process.geteuid()}\t${process.geteuid()}\t${process.geteuid()}\n`:`header\n${path.endsWith('/tcp')?'0: 0100007F:04D2 00000000:0000 0A 0:0 0:0 0 1000 0 77':''}\n`,
      list:path=>{if(path==='/proc/101/fd')throw Object.assign(new Error('gone'),{code:'ENOENT'});return path==='/proc/102/fd'?['0']:[];},
      link:()=>{if(laterFailure)throw Object.assign(new Error('private later denial'),{code:'EACCES'});return '/non-socket';},
      kill:()=>{throw Object.assign(new Error('gone'),{code:'ESRCH'});}};
    assert.throws(()=>linuxRuntimeListeners(100,1234,deps),error=>{
      assert.deepEqual(parseNativeListenerFailure(error.nativeListenerFailure),{stage:laterFailure?'READ_DESCRIPTOR':'ALL_LISTENERS_OWNED',cause:laterFailure?'EACCES':'ERR_ASSERTION',relation:'UNKNOWN',state:'UNKNOWN',uidEqual:null});return true;
    });
  }
});
