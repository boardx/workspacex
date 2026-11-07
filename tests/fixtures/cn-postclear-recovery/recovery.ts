/** Fixture-only continuation. Never imported by a production CLI. */
import {assertReheldContext} from './driver';
import {createHash} from 'node:crypto';
import {open,readFile,lstat} from 'node:fs/promises';
import {assertSourcePlanAuthority,type OriginalPlanAuthority} from '../../../packages/cloud-deploy/src/cn-maintenance-host/source_plan_authority';
export const databases=['workspacex','workspacex_agent','workspacex_memory'] as const;
export type Database=typeof databases[number];
export const digest=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const need=(v:unknown,c:string)=>{if(!v)throw Error(c);};
export interface Barrier {identity:unknown; originalPlanSha256:string; generation:string; held:boolean; writerSessions:number; preparedTransactions:number; sourcePeers:Record<Database,string>}
export interface Snapshot {generation:string; originalPlanSha256:string; databases:Record<Database,{archiveSha256:string;catalogSha256:string;dataSha256:string;postclearWriteSha256:string}>}
export interface FixturePort {
 assertOwnedLock():Promise<void>;
 observe():Promise<Barrier>;
 capture(generation:string):Promise<Snapshot>;
 restore(database:Database,source:Snapshot['databases'][Database],target:string):Promise<void>;
 readback(database:Database,target:string):Promise<Snapshot['databases'][Database]>;
}
export interface FixtureBinding {kind:'isolated-postclear-recovery-v1';root:string;oldGeneration:string;newGeneration:string;sourcePeers:Record<Database,string>;targets:Record<Database,string>;postclearWrites:Record<Database,string>}
function validateBinding(b:FixtureBinding){
 need(b.kind==='isolated-postclear-recovery-v1'&&/^\/tmp\/wsx-postclear-[a-f0-9]{32}$/.test(b.root),'FIXTURE_ROOT');
 need(/^[a-f0-9]{32}$/.test(b.oldGeneration)&&/^[a-f0-9]{32}$/.test(b.newGeneration)&&b.oldGeneration!==b.newGeneration,'NEW_GENERATION_REQUIRED');
 for(const field of ['sourcePeers','targets','postclearWrites'] as const)need(Object.keys(b[field]).sort().join(',')===[...databases].sort().join(','),'THREE_DATABASES_REQUIRED');
 for(const db of databases){
  need(new RegExp('^'+b.root+'/socket:'+db+'$').test(b.sourcePeers[db]),'ISOLATED_SOURCE_REQUIRED');
  need(b.targets[db]==='recovered_'+db,'ISOLATED_TARGET_REQUIRED');
  need(/^[a-f0-9]{64}$/.test(b.postclearWrites[db]),'POSTCLEAR_WRITE_REQUIRED');
 }
}
async function durableExclusive(path:string,value:unknown){
 const fd=await open(path,'wx',0o600);try{await fd.writeFile(JSON.stringify(value)+'\n');await fd.sync();}finally{await fd.close();}
 const directory=await open(path.slice(0,path.lastIndexOf('/')),'r');try{await directory.sync();}finally{await directory.close();}
}
/** The caller is the source-owned isolated driver, not data from a release plan. */
export async function recoverFixture(context:{authority:OriginalPlanAuthority;oldGeneration:string;newGeneration:string},binding:FixtureBinding,port:FixturePort){
 await assertReheldContext(context);const authority=context.authority;
 const b=structuredClone(binding);validateBinding(b);
 need(b.oldGeneration===context.oldGeneration&&b.newGeneration===context.newGeneration,'ACTUAL_GENERATION_BINDING');
 const root=await lstat(b.root);need(root.isDirectory()&&!root.isSymbolicLink()&&(root.mode&0o777)===0o700&&root.uid===process.getuid!(),'FIXTURE_PRIVATE_ROOT');
 const check=async()=>{
  await assertReheldContext(context);assertSourcePlanAuthority(authority,authority.identity,authority.toolRevision);
  const current=await lstat(b.root);need(current.dev===root.dev&&current.ino===root.ino&&current.isDirectory()&&(current.mode&0o777)===0o700,'FIXTURE_ROOT_CHANGED');
  await port.assertOwnedLock();const o=await port.observe();
  need(digest(o.identity)===digest(authority.identity)&&o.originalPlanSha256===authority.sourcePlanSha256&&o.generation===b.newGeneration&&o.held===true&&o.writerSessions===0&&o.preparedTransactions===0&&digest(o.sourcePeers)===digest(b.sourcePeers),'FRESH_REHELD_WRITERS_REQUIRED');
  return o;
 };
 await check();
 // Claim before capture/restore. No resume, cleanup or retry operation exists here.
 const claim={kind:b.kind,bindingSha256:digest(b),originalPlanSha256:authority.sourcePlanSha256};
 await durableExclusive(b.root+'/recovery-intent.json',claim);
 const snapshot=await port.capture(b.newGeneration);await check();
 need(snapshot.generation===b.newGeneration&&snapshot.originalPlanSha256===authority.sourcePlanSha256&&Object.keys(snapshot.databases).sort().join(',')===[...databases].sort().join(','),'FRESH_SNAPSHOT_REQUIRED');
 for(const db of databases){
  const s=snapshot.databases[db];
  need(Object.keys(s).sort().join(',')==='archiveSha256,catalogSha256,dataSha256,postclearWriteSha256'&&Object.values(s).every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v))&&s.postclearWriteSha256===b.postclearWrites[db],'SNAPSHOT_NEW_DATA_REQUIRED');
 }
 await durableExclusive(b.root+'/snapshot.json',snapshot);
 for(const db of databases){
  await check();await durableExclusive(b.root+'/'+db+'.intent.json',{snapshotSha256:digest(snapshot),target:b.targets[db]});
  await port.restore(db,snapshot.databases[db],b.targets[db]);await check();
  const actual=await port.readback(db,b.targets[db]);
  need(digest(actual)===digest(snapshot.databases[db]),'COMPLETE_READBACK_REQUIRED');
  await durableExclusive(b.root+'/'+db+'.receipt.json',actual);
 }
 await check();need(digest(JSON.parse(await readFile(b.root+'/snapshot.json','utf8')))===digest(snapshot),'SNAPSHOT_DRIFT');
 const receipt={kind:'isolated-postclear-recovered-v1',originalPlanSha256:authority.sourcePlanSha256,bindingSha256:digest(b),snapshotSha256:digest(snapshot),holdGeneration:b.newGeneration,writesHeld:true,ready:false,productionAccepted:false};
 await durableExclusive(b.root+'/recovered.json',receipt);return receipt;
}
