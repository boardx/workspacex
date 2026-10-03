import {test} from 'node:test';
import assert from 'node:assert/strict';
import {linuxRuntimeListeners} from './native-process-listeners.mjs';
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
    assert.throws(()=>linuxRuntimeListeners(100,1234,deps),actual=>actual===error);
  }
  for(const pid of [0,-1,NaN,1.5,'100'])assert.throws(()=>linuxRuntimeListeners(pid,1234,fixture()));
  for(const port of [0,-1,65536,1.5,'1234'])assert.throws(()=>linuxRuntimeListeners(100,port,fixture()));
});
test('closed descriptor races cannot create ownership or hide a foreign listener',()=>{
  const deps=fixture();deps.link=()=>{throw Object.assign(new Error('closed fd'),{code:'ENOENT'});};
  assert.throws(()=>linuxRuntimeListeners(100,1234,deps),/every kernel listener/);
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
  assert.throws(()=>linuxRuntimeListeners(100,1234,fixture({parents:'100 1\n101 102\n102 101'})),/every kernel listener/);
});
