import {test} from 'node:test';
import assert from 'node:assert/strict';
import {linuxRuntimeListeners} from './native-process-listeners.mjs';
const descendsFrom=(pid,root,parent)=>{const seen=new Set();while(pid>1&&!seen.has(pid)){if(pid===root)return true;seen.add(pid);pid=parent(pid);}return false;};
const stat=(pid,parent,state,start='10')=>`${pid} (private command ) name) ${state} ${parent} ${Array(17).fill('0').join(' ')} ${start} 0\n`;
function fixture({state='Z',tasks=['101'],startChanges=false,parentChanges=false,rootChanges=false,unreadable=false,missingInode=false,rootDenied=false,uidEqual=true,afterState=state,taskChanges=false,taskDenied=false,fdCode='EACCES',malformedStat=false}={}){
 const counts=new Map(),paths=[];let taskReads=0;
 const read=path=>{
  paths.push(path);const pid=Number(path.split('/')[2]);assert([100,101].includes(pid),'only proven owned PIDs may be read');
  if(path.endsWith('/stat')){
   if(malformedStat)return 'private malformed stat';
   if(unreadable)throw Object.assign(new Error('private denial'),{code:'EACCES'});
   const count=(counts.get(pid)??0)+1;counts.set(pid,count);
   return stat(pid,pid===100?1:parentChanges&&count>1?999:100,pid===100?'S':count>1?afterState:state,((pid===101&&startChanges)||(pid===100&&rootChanges))&&count>1?'11':'10');
  }
  if(path.endsWith('/status'))return `Name:\tprivate\nState:\t${state} (private)\nUid:\t${uidEqual?process.geteuid():999999}\t${uidEqual?process.geteuid():999999}\t0\t0\n`;
  return `header\n${path.endsWith('/tcp')?'0: 0100007F:04D2 00000000:0000 0A 0:0 0:0 0 1000 0 77':''}\n`;
 };
 return {paths,descendsFrom,read,exec:()=> '100 1\n101 100\n999 1',list:path=>{paths.push(path);if(path.endsWith('/task')){if(taskDenied)throw Object.assign(new Error('private task denial'),{code:'EACCES'});return taskChanges&&++taskReads>1?['101','102']:tasks;}if(path==='/proc/101/fd'||rootDenied)throw Object.assign(new Error('private fd denial'),{code:fdCode});return ['0'];},link:()=>missingInode?'/file':'socket:[77]'};
}
test('only stable owned single-task zombie can be excluded; live owner still supplies every inode',()=>{
 const deps=fixture();assert.deepEqual(linuxRuntimeListeners(100,1234,deps),[100]);assert(!deps.paths.some(path=>path.includes('/999/')));
});
test('root and live/unknown states remain blocked even if a socket is otherwise owned',()=>{
 for(const state of ['R','S','D','T','t','I','X','UNKNOWN'])assert.throws(()=>linuxRuntimeListeners(100,1234,fixture({state})),error=>error.nativeListenerFailure.cause==='EACCES');
 assert.throws(()=>linuxRuntimeListeners(100,1234,fixture({rootDenied:true})),error=>error.nativeListenerFailure.relation==='ROOT'&&error.nativeListenerFailure.cause==='EACCES');
});
test('PID reuse, reparenting, root identity drift, unavailable identity, UID mismatch and live sibling threads reject',()=>{
 for(const options of [{startChanges:true},{parentChanges:true},{rootChanges:true},{unreadable:true},{uidEqual:false},{tasks:['101','102']},{tasks:[]},{tasks:['private']},{afterState:'S'},{taskChanges:true},{taskDenied:true},{malformedStat:true}])assert.throws(()=>linuxRuntimeListeners(100,1234,fixture(options)),error=>error.nativeListenerFailure.cause==='EACCES');
 assert.throws(()=>linuxRuntimeListeners(100,1234,fixture({fdCode:'EPERM'})),error=>error.nativeListenerFailure.cause==='EPERM');
});
test('excluding a zombie never creates socket ownership or hides missing inodes',()=>{
 assert.throws(()=>linuxRuntimeListeners(100,1234,fixture({missingInode:true})),error=>error.nativeListenerFailure.stage==='ALL_LISTENERS_OWNED'&&error.nativeListenerFailure.state==='UNKNOWN');
});
