import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { whiteboardStoragePermissionBoundaries, verifyWhiteboardStoragePermissionBoundaries } from '../../scripts/whiteboard-storage-permission-boundaries.mjs';
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
 ] as const)('rejects removal of %s',(_name,file,from,to)=>{
  expect(audit(path(file),source=>source.replace(from,to)).length).toBeGreaterThan(0);
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
