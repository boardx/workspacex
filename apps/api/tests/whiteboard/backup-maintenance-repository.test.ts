import {assertLocalMaintenanceAcceptance} from '../support/board-maintenance-isolation';
import {it,expect} from 'vitest';
import type {DatabasePort,TenantSession} from '../../src/application/ports/database.port';
import {PgBackupMaintenance} from '../../src/infrastructure/whiteboard/pg-backup-maintenance';
import {backupHash,backupTenant,validateBackupManifest} from '../../src/application/whiteboard/board-backup';
import {archiveRootsOverlap} from '../../src/infrastructure/whiteboard/maintenance-archive-paths';
import {toOrgId} from '../../src/domain/org-id';
const p={orgId:toOrgId('maintenance-repository'),userId:'owner'},boardId='10000000-0000-4000-8000-000000000001',backupId='20000000-0000-4000-8000-000000000001',requestId='30000000-0000-4000-8000-000000000001';
function fixture(){
 const blob={key:`whiteboards/tenants/${backupTenant(p.orgId)}/boards/${boardId}/snapshot.yjs`,hash:'a'.repeat(64),bytes:2,mime:'application/vnd.yjs-update'};
 const manifest=validateBackupManifest({version:1,backupId,orgId:p.orgId,capturedAt:'2026-08-01T00:00:00Z',board:{id:boardId,name:'Synthetic',ownerId:p.userId,createdAt:'2026-08-01T00:00:00Z',updatedAt:'2026-08-01T00:00:00Z',archived:false,lifecycleRevision:0,tagsRevision:0,members:[],tags:[]},revision:{epoch:1,seq:2},snapshot:blob,images:[],comments:[]});
 const state={member:true,role:'consultant',boardOwner:'owner' as string|null,originalActor:'owner',receiptActor:'owner',receipt:null as unknown,status:'verified',createdAt:new Date('2026-08-01'),restores:0,seq:'2',hash:blob.hash,pins:2,committed:false};
 const calls:Array<{sql:string;args:unknown[]}> = [];
 const session={query:async(sql:string,args:unknown[]=[])=>{
  calls.push({sql,args});let rows:unknown[]=[];
  if(sql.includes('FROM org_memberships'))rows=state.member?[{org_role:state.role}]:[];
  else if(sql.startsWith('SELECT source_board_id'))rows=[{source_board_id:boardId,actor_id:state.originalActor}];
  else if(sql.startsWith('SELECT owner_id'))rows=state.boardOwner?[{owner_id:state.boardOwner}]:[];
  else if(sql.startsWith('SELECT capture'))rows=[{capture:manifest,status:state.status,manifest_hash:backupHash(JSON.stringify(manifest)),created_at:state.createdAt}];
  else if(sql.includes('FROM whiteboard_backup_pins'))rows=[{n:String(state.pins)}];
  else if(sql.includes('FROM whiteboard_backup_restores'))rows=[{n:String(state.restores)}];
  else if(sql.startsWith('SELECT payload'))rows=state.receipt?[{payload:state.receipt,actor_id:state.receiptActor}]:[];
  else if(sql.startsWith('SELECT epoch'))rows=[{epoch:1,seq:state.seq,manifest_version:1,content_hash:state.hash,byte_size:'2',object_key:blob.key,inline:false}];
  else if(sql.startsWith('UPDATE whiteboard_backup_pins'))rows=Array.from({length:state.pins},(_,i)=>({object_key:`key-${i}`}));
  else if(sql.startsWith('UPDATE whiteboard_documents'))rows=[{board_id:boardId}];
  else if(!sql.startsWith('INSERT INTO whiteboard_backup_maintenance_receipts'))throw Error(`Unexpected maintenance SQL: ${sql}`);
  return{rows,rowCount:rows.length};
 }} as unknown as TenantSession;
 const db={withTenant:async(org:string,fn:(s:TenantSession)=>Promise<unknown>)=>{expect(org).toBe(p.orgId);const value=await fn(session);state.committed=true;return value;}} as DatabasePort;
 return{repo:new PgBackupMaintenance(db),state,calls,manifest,blob,manifestHash:backupHash(JSON.stringify(manifest))};
}
const release={action:'release-pins' as const,backupId,requestId,retentionDays:30};
const recover={action:'recover-manifest' as const,backupId,requestId,boardId,expectedEpoch:1,expectedSeq:2,targetVersion:1 as const};
it.each(['revoked','different-owner','different-receipt-actor'])('does not disclose or replay maintenance after %s',async mode=>{
 const f=fixture();if(mode==='revoked')f.state.member=false;if(mode==='different-owner')f.state.boardOwner='someone-else';if(mode==='different-receipt-actor'){f.state.receipt={};f.state.receiptActor='someone-else';}
 await expect(f.repo.inspect(p,release)).rejects.toMatchObject({code:mode==='different-receipt-actor'?'IDEMPOTENCY_CONFLICT':'NOT_FOUND'});
 expect(f.calls.some(call=>call.sql.startsWith('UPDATE')||call.sql.startsWith('INSERT'))).toBe(false);
});
it('permits a current admin and the original active owner for a deleted source without granting editor access',async()=>{
 const f=fixture();f.state.boardOwner='someone-else';f.state.role='admin';await expect(f.repo.inspect(p,release)).resolves.toMatchObject({activePins:2});
 const deleted=fixture();deleted.state.boardOwner=null;await expect(deleted.repo.inspect(p,release)).resolves.toMatchObject({activePins:2});
 deleted.state.originalActor='someone-else';await expect(deleted.repo.inspect(p,release)).rejects.toMatchObject({code:'NOT_FOUND'});
});
it.each(['restore','young','unverified','changed-manifest'])('rechecks %s inside the final locked release transaction',async mode=>{
 const f=fixture();if(mode==='restore')f.state.restores=1;if(mode==='young')f.state.createdAt=new Date();if(mode==='unverified')f.state.status='preparing';
 await expect(f.repo.release(p,release,mode==='changed-manifest'?'0'.repeat(64):f.manifestHash,new Date('2026-09-01'),'request-hash')).rejects.toBeDefined();
 expect(f.calls.some(call=>call.sql.startsWith('UPDATE'))).toBe(false);expect(f.state.committed).toBe(false);
});
it('locks membership then source Board then backup before releasing only backup-specific pins',async()=>{
 const f=fixture();await f.repo.release(p,release,f.manifestHash,new Date('2026-09-01'),'request-hash');
 const locks=f.calls.filter(c=>/FOR SHARE|FOR UPDATE/.test(c.sql)).map(c=>c.sql);
 expect(locks[0]).toContain('org_memberships');expect(locks[1]).toContain('FROM whiteboards');expect(locks[2]).toContain('FROM whiteboard_backups');
 expect(f.calls.filter(c=>c.sql.startsWith('UPDATE')).map(c=>c.sql)).toEqual([expect.stringContaining('UPDATE whiteboard_backup_pins SET released_at=now()')]);
 expect(f.calls.some(c=>c.sql.includes('DELETE'))).toBe(false);
});
it.each(['revision','digest','cross-board-key'])('rejects stale or foreign %s at the recovery publication boundary',async mode=>{
 const f=fixture();if(mode==='revision')f.state.seq='3';if(mode==='digest')f.state.hash='b'.repeat(64);
 const key=`whiteboards/tenants/${backupTenant(p.orgId)}/boards/${mode==='cross-board-key'?'other':boardId}/epochs/1/recovered/${requestId}-${f.blob.hash}.yjs`;
 await expect(f.repo.recover(p,recover,f.manifestHash,{...f.blob,key},'request-hash')).rejects.toBeDefined();expect(f.calls.some(c=>c.sql.startsWith('UPDATE'))).toBe(false);
});

it.each(['/store','/store/archive','/store/..archive'])('rejects overlapping archive path %s',archive=>{expect(archiveRootsOverlap('/store',archive)).toBe(true);expect(archiveRootsOverlap(archive,'/store')).toBe(true);});
it('accepts separate resolved archive directories',()=>{expect(archiveRootsOverlap('/store-primary','/store-archive')).toBe(false);});

it.each([{PGHOST:'remote.example'}, {WORKSPACEX_DB:'production'}, {PGDATABASE:'other'}, {WORKSPACEX_ISOLATION_ID:''}, {WORKSPACEX_DEPLOY_PROFILE:'production'}])('rejects unsafe acceptance environment before any DB setup: %j',override=>{
 const safe={WORKSPACEX_ISOLATION_ID:'maintenance-test',WORKSPACEX_DB:'wsx_'+'a'.repeat(20),PGDATABASE:'wsx_'+'a'.repeat(20),PGHOST:'127.0.0.1'};
 expect(()=>assertLocalMaintenanceAcceptance(safe)).not.toThrow();expect(()=>assertLocalMaintenanceAcceptance({...safe,...override})).toThrow('ISOLATED_LOCAL_MAINTENANCE_ACCEPTANCE_REQUIRED');
});
