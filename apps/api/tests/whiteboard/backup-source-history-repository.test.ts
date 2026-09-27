import { describe,expect,it } from 'vitest';
import * as Y from 'yjs';
import { createWhiteboardDocument } from '@repo/whiteboard-core';
import { PgBoardBackupRepository } from '../../src/infrastructure/whiteboard/pg-board-backup';
import { backupHash,backupTenant,validateBackupManifest } from '../../src/application/whiteboard/board-backup';
import type { DatabasePort,TenantSession } from '../../src/application/ports/database.port';
import { toOrgId } from '../../src/domain/org-id';
const p={orgId:toOrgId('history-unit'),userId:'owner'},board='11111111-1111-4111-8111-111111111111',backup='22222222-2222-4222-8222-222222222222',date='2026-09-27T00:00:00.000Z';
function fixture(){
 const doc=createWhiteboardDocument(),update=Y.encodeStateAsUpdate(doc);doc.destroy();
 const hash=backupHash(update),prefix=`whiteboards/tenants/${backupTenant(p.orgId)}/boards/${board}/`;
 const snapshot={key:`${prefix}epochs/1/snapshots/0-${hash}.yjs`,hash,bytes:update.length,mime:'application/vnd.yjs-update'};
 const history={key:`${prefix}proposal-bodies/${'a'.repeat(64)}.json`,hash:'a'.repeat(64),bytes:100,mime:'application/json'};
 const manifest=validateBackupManifest({version:1,backupId:backup,orgId:p.orgId,capturedAt:date,board:{id:board,name:'test',ownerId:p.userId,createdAt:date,updatedAt:date,archived:false,lifecycleRevision:0,tagsRevision:0,members:[],tags:[]},revision:{epoch:1,seq:0},snapshot,images:[],comments:[],sourceHistory:[history]});
 const calls:Array<{sql:string;params:readonly unknown[]}>=[];let capturing=false,changed=false,denied=false;
 const session={query:async(sql:string,params:readonly unknown[]=[])=>{
  calls.push({sql,params});
  if(sql.startsWith('SELECT source_board_id'))return{rows:[{source_board_id:board}]};
  if(sql.includes('FROM org_memberships'))return{rows:denied?[]:[{user_id:p.userId}]};
  if(sql.startsWith('SELECT owner_id'))return{rows:[{owner_id:p.userId}]};
  if(sql.startsWith('SELECT capture'))return{rows:capturing?[]:[{capture:manifest,status:'verified',manifest_hash:'b'.repeat(64),source_board_id:board}]};
  if(sql.includes('FROM whiteboard_documents'))return{rows:[{epoch:1,seq:'0',object_key:snapshot.key,content_hash:snapshot.hash,byte_size:String(snapshot.bytes)}]};
  if(sql.includes('FROM whiteboard_comment_threads'))return{rows:[]};
  if(sql.includes('FROM whiteboard_asset_refs r'))return{rows:[{...history,bytes:String(history.bytes),...(changed?{hash:'c'.repeat(64)}:{})}]};
  if(sql.startsWith('SELECT name,owner_id'))return{rows:[{name:'test',owner_id:p.userId,created_at:date,updated_at:date,archived:false,lifecycle_revision:0,tags_revision:0}]};
  return{rows:[]};
 }} as TenantSession;
 const db={withTenant:async(_org:unknown,fn:(s:TenantSession)=>unknown)=>fn(session)} as DatabasePort;
 const repo=new PgBoardBackupRepository(db,{loadInTransaction:async()=>({update,epoch:1,seq:0})} as never,{captureBackupInTransaction:async()=>[]} as never);
 return{repo,manifest,history,calls,capture(){capturing=true;},change(){changed=true;},deny(){denied=true;}};
}
describe('PG backup source history boundary',()=>{
 it('captures and pins active source history in the same metadata transaction',async()=>{
  const f=fixture();f.capture();const record=await f.repo.capture(p,board,backup);
  expect(record.manifest.sourceHistory).toEqual([f.history]);
  expect(f.calls.some(c=>c.sql.includes('INSERT INTO whiteboard_backup_pins')&&c.params[2]===f.history.key)).toBe(true);
  const query=f.calls.find(c=>c.sql.includes('FROM whiteboard_asset_refs r'))!.sql;
  expect(query).toContain("r.state='active'");expect(query).toContain('r.released_at IS NULL');expect(query).toContain('FOR SHARE OF r');expect(query).not.toContain('FOR SHARE OF a');
 });
 it('verifies source metadata before invoking filesystem publication',async()=>{
  const f=fixture();let count=0;await f.repo.withSourceRestore(p,f.manifest,async()=>{count++;});expect(count).toBe(1);
  f.change();await expect(f.repo.withSourceRestore(p,f.manifest,async()=>{count++;})).rejects.toThrow('SOURCE_CHANGED');expect(count).toBe(1);
 });
 it('rechecks current organization membership even for a verified archive',async()=>{
  const f=fixture();f.deny();let count=0;await expect(f.repo.withSourceRestore(p,f.manifest,async()=>{count++;})).rejects.toThrow('NOT_FOUND');expect(count).toBe(0);
 });
});
