import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error production lint helpers are intentionally plain ESM.
import { whiteboardStoragePermissionBoundaries, verifyWhiteboardStoragePermissionBoundaries } from '../../scripts/whiteboard-storage-permission-boundaries.mjs';
// @ts-expect-error production lint helpers are intentionally plain ESM.
import { verifyWhiteboardPermissionBoundaries } from '../../scripts/whiteboard-permission-boundaries.mjs';
const root=resolve(__dirname,'../..');
const path=(name:string)=>`src/infrastructure/whiteboard/${name}.ts`;
const read=(name:string)=>readFileSync(resolve(root,name),'utf8');
function audit(name:string,mutate:(source:string)=>string){
 const original=read(name),changed=mutate(original);expect(changed).not.toBe(original);
 return verifyWhiteboardStoragePermissionBoundaries((file:string)=>file===name?changed:read(file));
}
describe('precise storage adapter permission admission',()=>{
 it('admits exactly the audited method/query inventories and authorization dependencies',()=>{
  expect(verifyWhiteboardStoragePermissionBoundaries(read)).toEqual([]);
  const tables=new Set<string>([...whiteboardStoragePermissionBoundaries.values()].flatMap(rule=>rule.tables));
  // Other legacy boundaries (including copy) are independently maintained. This
  // assertion exercises the production integration without hiding our failures.
  expect(verifyWhiteboardPermissionBoundaries(read,tables).filter((failure:string)=>[...whiteboardStoragePermissionBoundaries.keys()].some(name=>failure.startsWith(`${name}:`)))).toEqual([]);
 });
 it.each([
  ['membership actor', 'storage-maintenance-access', 'user_id=$2 FOR SHARE','user_id=$3 FOR SHARE'],
  ['membership lock', 'storage-maintenance-access', 'FOR SHARE',''],
  ['identity authority', 'storage-maintenance-access', 'canExportOrganization(member.rows[0].org_role)','true'],
  ['nonadmin enumeration', 'storage-maintenance-access', "if(!member.administrator)throw new StorageBackfillError('FORBIDDEN');",''],
  ['board ownership', 'storage-maintenance-access', 'board.rows[0].owner_id!==p.userId','false'],
  ['board lock', 'storage-maintenance-access', 'FOR UPDATE',''],
  ['backfill list authorization','pg-storage-backfill','await lockBoardStorageMaintenance(s,p);',''],
  ['backfill inspect authorization','pg-storage-backfill','...await lockBoardStorageMaintenance(s,p,id)','...{}'],
  ['backfill migrate authorization','pg-storage-backfill','const access=await lockBoardStorageMaintenance(s,p,id)','const access={}'],
  ['backfill receipt tenant','pg-storage-backfill','FROM whiteboard_comment_requests WHERE org_id=$1 AND board_id=$2','FROM whiteboard_comment_requests WHERE board_id=$2'],
  ['backfill content bytes instead of counts','pg-storage-backfill','snapshots:Number(row.snapshots)','snapshots:row'],
  ['maintenance owner gate','pg-backup-maintenance','boards.rows[0].owner_id!==p.userId','false'],
  ['deleted source actor','pg-backup-maintenance','owner.actor_id!==p.userId','false'],
  ['maintenance source binding','pg-backup-maintenance','owner.source_board_id!==request.boardId','false'],
  ['maintenance receipt actor','pg-backup-maintenance','receipts.rows[0].actor_id!==p.userId','false'],
  ['maintenance retry reauthorization','pg-backup-maintenance','const state=await this.state(s,p,request),replay','const state={} as MaintenanceState,replay'],
  ['maintenance busy restore','pg-backup-maintenance',"if(state.activeRestores)fail('RESTORE_IN_PROGRESS');",''],
  ['manifest compare and swap','pg-backup-maintenance','AND epoch=$3 AND seq=$4 AND content_hash=$6','AND epoch=$3 AND seq=$4'],
  ['manifest target key','pg-backup-maintenance','ref.key!==expectedKey','false'],
  ['portable write role','pg-portable-board',"!['owner','editor'].includes(role!)",'false'],
  ['portable archive','pg-portable-board','if(board.archived)','if(false)'],
  ['portable receipt tenant','pg-portable-board','WHERE org_id=$1 AND board_id=$2 AND actor_id=$3 AND request_id=$4','WHERE board_id=$2 AND actor_id=$3 AND request_id=$4'],
  ['portable readback digest','pg-portable-board','`sha256:${portableHash(bytes)}`!==image.metadata.contentDigest','false'],
  ['portable transaction propagation','pg-portable-board','this.assets.saveInTransaction(session,p,boardId,record)','this.assets.save(p,boardId,record)'],
  ['image board scope','pg-image-assets','AND a.board_id=$2',''],
  ['image active reference','pg-image-assets',"AND r.state='active' AND r.released_at IS NULL",''],
  ['image import pending lease','pg-image-assets',"'pending',now()+interval '24 hours'","'active',now()+interval '24 hours'"],
 ] as const)('rejects removal of %s',(_name,file,from,to)=>{
  expect(audit(path(file),source=>source.replace(from,to)).length).toBeGreaterThan(0);
 });
 it.each([
  'const lockBoardStorageMaintenance=async(...args:unknown[])=>{};',
  'const {lockBoardStorageMaintenance}=untrusted;',
  'lockBoardStorageMaintenance=async()=>{};',
 ] as const)('rejects authority shadow/rebinding %s',injection=>{
  expect(audit(path('pg-storage-backfill'),source=>source.replace('await lockBoardStorageMaintenance(s,p);',injection+'await lockBoardStorageMaintenance(s,p);')).length).toBeGreaterThan(0);
 });
 it('rejects importing another export under the trusted name',()=>{
  expect(audit(path('pg-storage-backfill'),source=>source.replace('import {lockBoardStorageMaintenance}', 'import {noop as lockBoardStorageMaintenance}')).length).toBeGreaterThan(0);
 });
 it.each([
  'this.state=async()=>({});',
  'const self=this;self.state=async()=>({});',
  "Object.assign(this,{state:async()=>({})});",
  "Object.defineProperty(this,'state',{value:async()=>({})});",
 ] as const)('rejects receiver authority replacement %s',injection=>{
  expect(audit(path('pg-backup-maintenance'),source=>source.replace('const state=await this.state(s,p,request),replay',injection+'const state=await this.state(s,p,request),replay')).length).toBeGreaterThan(0);
 });
 it.each([
  ['dead branch','if(false){await lockBoardStorageMaintenance(s,p);}'],
  ['conditional branch','if(after){await lockBoardStorageMaintenance(s,p);}'],
  ['uncalled closure','const later=async()=>{await lockBoardStorageMaintenance(s,p);};'],
  ['unawaited call','lockBoardStorageMaintenance(s,p);'],
  ['short circuit','false && await lockBoardStorageMaintenance(s,p);'],
 ] as const)('rejects %s authorization',(_name,replacement)=>{
  expect(audit(path('pg-storage-backfill'),source=>source.replace('await lockBoardStorageMaintenance(s,p);',replacement)).length).toBeGreaterThan(0);
 });
 it.each([
  "await session['query']('SELECT metadata FROM whiteboard_image_assets');",
  "const q=session.query;await q('SELECT metadata FROM whiteboard_image_assets');",
  "const {query:q}=session;await q('SELECT metadata FROM whiteboard_image_assets');",
  "const q=session['q'+'uery'];await q('SELECT metadata FROM whiteboard_image_assets');",
  "const q=Reflect.get(session,'query');await q('SELECT metadata FROM whiteboard_image_assets');",
  "const alias=session;const q=alias['q'+'uery'];await q('SELECT metadata FROM whiteboard_image_assets');",
 ] as const)('rejects computed/aliased query bypass %s',injection=>{
  expect(audit(path('pg-image-assets'),source=>source.replace('const row = result.rows[0];',injection+'const row = result.rows[0];')).length).toBeGreaterThan(0);
 });
 it('rejects hiding the actual owner denial in a dead branch',()=>{
  const guard="if(!board.rows[0]||(!member.administrator&&board.rows[0].owner_id!==p.userId))throw new StorageBackfillError('NOT_FOUND');";
  expect(audit(path('storage-maintenance-access'),source=>source.replace(guard,`if(false){${guard}}`)).length).toBeGreaterThan(0);
 });
 it('does not accept authorization only mentioned in a comment',()=>{
  expect(audit(path('pg-storage-backfill'),source=>source.replace('await lockBoardStorageMaintenance(s,p);','/* await lockBoardStorageMaintenance(s,p); */')).length).toBeGreaterThan(0);
 });
 it('does not let a new same-table raw read inherit the file admission',()=>{
  expect(audit(path('pg-image-assets'),source=>source.replace('  async get(',"  async leak(p: Principal) { return this.db.withTenant(p.orgId,s=>s.query('SELECT metadata FROM whiteboard_image_assets')); }\n  async get(")).length).toBeGreaterThan(0);
 });
 it('rejects same-table queries outside the admitted methods',()=>{
  expect(audit(path('pg-image-assets'),source=>source+"\n globalSession.query('SELECT metadata FROM whiteboard_image_assets');").length).toBeGreaterThan(0);
 });
 it('counts additional reads even inside an existing method',()=>{
  expect(audit(path('pg-image-assets'),source=>source.replace('const row = result.rows[0];',"await session.query('SELECT metadata FROM whiteboard_image_assets'); const row = result.rows[0];")).length).toBeGreaterThan(0);
 });
 it('rejects moving maintenance reads before the owner gate',()=>{
  expect(audit(path('pg-backup-maintenance'),source=>{
   const start=source.indexOf('  const records='),end=source.indexOf('\n',start),statement=source.slice(start,end);
   return (source.slice(0,start)+source.slice(end)).replace('  const boards=',statement+'\n  const boards=');
  }).length).toBeGreaterThan(0);
 });
 const service='src/application/whiteboard/image-assets.ts';
 it('requires fresh ACL after blob I/O, not just before reading metadata',()=>{
  expect(audit(service,source=>source.replace('    await this.access(p, boardId, false);\n    return { metadata:', '    return { metadata:')).length).toBeGreaterThan(0);
 });
 it('requires image storage key to bind tenant and destination board',()=>{
  expect(audit(service,source=>source.replace("update(p.orgId)","update('other-tenant')")).length).toBeGreaterThan(0);
 });
 it('requires actual blob digest validation before returning bytes',()=>{
  expect(audit(service,source=>source.replace("createHash('sha256').update(bytes).digest('hex')","record.metadata.contentDigest")).length).toBeGreaterThan(0);
 });
});

describe('delegated AI actor directory admission',()=>{
 it.each([
  ['org_id=$1 AND ', ''], ['delegated_by=$2 AND ', ''], ['enabled=true AND ', ''], ["kind='ai'",'true'],
  ['[p.orgId,p.userId]','[p.orgId,untrusted.userId]'], ['SELECT actor_id FROM','SELECT * FROM'],
  ['LIMIT 50','LIMIT 5000'], ['assertPrincipal(p);','if(false){assertPrincipal(p);}'],
  ['assertPrincipal(p);','const assertPrincipal=()=>{};assertPrincipal(p);'],
  ['s.query<',"s['query']<"], ['async list(p:Principal){','async list(p:Principal){const query=s.query;'],
 ] as const)('rejects actor directory mutation %s',(from,to)=>{
  expect(audit(path('pg-organize-actor-directory'),source=>source.replace(from,to)).length).toBeGreaterThan(0);
 });
});
