import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { whiteboardFileExport as C } from '@repo/contracts';
import { PgDatabase } from '../../src/infrastructure/db/pg-database';
import { appConfig } from '../../src/infrastructure/db/pg-config';
import { PgWhiteboardFileExportRepository } from '../../src/infrastructure/whiteboard/pg-whiteboard-file-export-repository';
import { PgWhiteboardRepository } from '../../src/infrastructure/whiteboard/pg-whiteboard-repository';
import { toOrgId } from '../../src/domain/org-id';
import type { Principal } from '../../src/domain/principal';
import { addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from '../support/db';

const orgId=toOrgId('wb-file-export-4052-a'),otherOrg=toOrgId('wb-file-export-4052-b');
const actor=(userId:string,org=orgId):Principal=>({userId,orgId:org});
const owner=actor('wb-4052-owner'),editor=actor('wb-4052-editor'),viewer=actor('wb-4052-viewer'),crossTenantSameUser=actor(editor.userId,otherOrg);
let db:PgDatabase,jobs:PgWhiteboardFileExportRepository,boards:PgWhiteboardRepository,boardId:string,secondBoardId:string;
const queued=(format:C.BoardFileExportFormat='png',targetBoard=boardId)=>C.BoardFileExportStatus.parse({jobId:randomUUID(),boardId:targetBoard,format,status:'queued',progress:0,filename:`board.${format==='sticky-csv'?'csv':format}`,mimeType:format==='png'?'image/png':format==='svg'?'image/svg+xml':format==='pdf'?'application/pdf':'text/csv; charset=utf-8',objectCount:0,pageOrder:[],losses:[],sizeBytes:null,errorCode:null});

beforeAll(async()=>{
  ensureDatabase();await migrateOnce();await resetOrgs(orgId,otherOrg);
  await seedOrg({orgId,projectId:'wb-4052-project-a'});await seedOrg({orgId:otherOrg,projectId:'wb-4052-project-b'});
  for(const principal of [owner,editor,viewer,crossTenantSameUser])await addOrgMember(principal.orgId,principal.userId,'consultant',null);
  db=new PgDatabase(appConfig());jobs=new PgWhiteboardFileExportRepository(db);boards=new PgWhiteboardRepository(db);
  const board=await boards.create(owner,{requestId:randomUUID(),name:'Export security'});boardId=board.id;secondBoardId=(await boards.create(owner,{requestId:randomUUID(),name:'Export concurrency'})).id;
  expect(await boards.putMember(owner,boardId,{userId:editor.userId,role:'editor'})).toBe(true);
  expect(await boards.putMember(owner,boardId,{userId:viewer.userId,role:'viewer'})).toBe(true);
});
afterAll(async()=>{await db?.close();await resetOrgs(orgId,otherOrg);});

async function complete(principal:Principal){
  const initial=queued();await jobs.create(principal,initial,{format:'png',background:'#ffffff'});const claim=await jobs.claimNext(`test-${initial.jobId}`,30_000,2);expect(claim?.status.jobId).toBe(initial.jobId);await jobs.renew(claim!,40,30_000);
  const bytes=new TextEncoder().encode('real immutable artifact'),sha=createHash('sha256').update(bytes).digest('hex');
  const done=C.BoardFileExportStatus.parse({...initial,status:'done',progress:100,objectCount:3,pageOrder:['frame'],sizeBytes:bytes.length,errorCode:null});
  expect(await jobs.complete(claim!,done,sha)).toBe(true);
  return{initial,done,sha};
}

describe('Board file export repository on real PostgreSQL',()=>{
  it.each([['owner',owner],['editor',editor],['viewer',viewer]] as const)('persists an authorized %s create → running → complete → find lifecycle',async(_role,principal)=>{
    const {initial,done,sha}=await complete(principal),found=await jobs.find(principal,initial.jobId);
    expect(found).toEqual({status:done,objectKey:`whiteboard-exports/${principal.orgId}/${initial.jobId}.png`,sha256:sha});
  });

  it('hides status and locators after membership revocation and refuses cancellation',async()=>{
    const initial=queued('pdf');await jobs.create(viewer,initial,{format:'pdf',background:'transparent'});const claim=await jobs.claimNext(`test-${initial.jobId}`,30_000,2);expect(claim?.status.jobId).toBe(initial.jobId);
    expect(await boards.removeMember(owner,boardId,viewer.userId)).toBe(true);
    expect(await jobs.find(viewer,initial.jobId)).toBeNull();expect(await jobs.cancel(viewer,initial.jobId)).toBeNull();
    await jobs.finish(claim!,C.BoardFileExportStatus.parse({...claim!.status,status:'failed',errorCode:'GENERATION_FAILED'}));
  });

  it('hides a same job id from another tenant even when the user id matches and RLS is queried directly',async()=>{
    const {initial}=await complete(editor);
    expect(await jobs.find(crossTenantSameUser,initial.jobId)).toBeNull();
    const rows=await asApp(otherOrg,c=>c.query(`SELECT id,object_key FROM whiteboard_file_export_jobs WHERE id=$1`,[initial.jobId]));expect(rows.rows).toEqual([]);
  });

  it('replays the additive migration twice without changing committed schema or data',async()=>{
    const sql=readFileSync(new URL('../../migrations/20260924000900_whiteboard_file_export_audit.sql',import.meta.url),'utf8');
    await asOwner(async client=>{await client.query('BEGIN');try{await client.query(sql);await client.query(sql);}finally{await client.query('ROLLBACK');}});
    const columns=await asApp(orgId,c=>c.query<{column_name:string}>(`SELECT column_name FROM information_schema.columns WHERE table_name='whiteboard_file_export_jobs' ORDER BY column_name`));
    expect(columns.rows.map(row=>row.column_name)).toContain('object_key');
  });

  it('globally admits two claims and recovers an expired running lease after restart',async()=>{
    const entries=await Promise.all(Array.from({length:3},async()=>{const initial=queued('svg');await jobs.create(owner,initial,{format:'svg',background:'#ffffff'});return initial;}));
    const claims=await Promise.all(entries.map((_,index)=>jobs.claimNext(`concurrent-${index}`,30_000,2)));expect(claims.filter(Boolean)).toHaveLength(2);
    const first=claims.find(Boolean)!;await asApp(orgId,c=>c.query(`UPDATE whiteboard_file_export_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE org_id=$1 AND id=$2`,[orgId,first.status.jobId]));
    const recovered=await new PgWhiteboardFileExportRepository(db).claimNext('restarted-worker',30_000,2);expect(recovered?.status.jobId).toBe(first.status.jobId);
    for(const claim of [...claims,recovered].filter((value):value is NonNullable<typeof value>=>Boolean(value))){await jobs.finish(claim,C.BoardFileExportStatus.parse({...claim.status,status:'failed',errorCode:'GENERATION_FAILED'}));}
    const remaining=await jobs.claimNext('drain-third',30_000,2);if(remaining)await jobs.finish(remaining,C.BoardFileExportStatus.parse({...remaining.status,status:'failed',errorCode:'GENERATION_FAILED'}));
  });

  it('terminalizes the eighth expired lease and makes its immutable key reachable by cleanup',async()=>{
    const initial=queued('svg');await jobs.create(editor,initial,{format:'svg',background:'#ffffff'});
    for(let attempt=1;attempt<=8;attempt++){const claim=await jobs.claimNext(`crash-${attempt}`,1_000,2);expect(claim?.status.jobId).toBe(initial.jobId);await asApp(orgId,c=>c.query(`UPDATE whiteboard_file_export_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE org_id=$1 AND id=$2`,[orgId,initial.jobId]));}
    expect(await jobs.claimNext('after-eighth-crash',1_000,2)).toBeNull();expect((await jobs.find(editor,initial.jobId))?.status).toMatchObject({status:'failed',errorCode:'GENERATION_FAILED'});
    const cleanup=await jobs.claimCleanup('crash-cleaner');expect(cleanup?.jobId).toBe(initial.jobId);await jobs.finishCleanup(cleanup!,true);const row=await asApp(orgId,c=>c.query<{artifact_state:string}>(`SELECT artifact_state FROM whiteboard_file_export_jobs WHERE org_id=$1 AND id=$2`,[orgId,initial.jobId]));expect(row.rows[0]?.artifact_state).toBe('purged');
  });

  it('retains twenty terminal exports, hides the oldest, and schedules its referenced object for deletion',async()=>{
    const history=actor('wb-4052-history');await addOrgMember(orgId,history.userId,'consultant',null);expect(await boards.putMember(owner,boardId,{userId:history.userId,role:'editor'})).toBe(true);const ids:string[]=[];
    for(let index=0;index<21;index++){const initial=queued('svg');ids.push(initial.jobId);await jobs.create(history,initial,{format:'svg',background:'#ffffff'});const claim=await jobs.claimNext(`history-${index}`,30_000,2);expect(claim?.status.jobId).toBe(initial.jobId);const done=C.BoardFileExportStatus.parse({...initial,status:'done',progress:100,sizeBytes:3});expect(await jobs.complete(claim!,done,'a'.repeat(64))).toBe(true);}
    expect(await jobs.find(history,ids[0]!)).toBeNull();const retained=await asApp(orgId,c=>c.query<{count:string}>(`SELECT count(*)::text count FROM whiteboard_file_export_jobs WHERE org_id=$1 AND actor_id=$2 AND NOT retention_evicted`,[orgId,history.userId]));expect(Number(retained.rows[0]?.count)).toBe(20);const oldest=await asApp(orgId,c=>c.query<{artifact_state:string;retention_evicted:boolean}>(`SELECT artifact_state,retention_evicted FROM whiteboard_file_export_jobs WHERE org_id=$1 AND id=$2`,[orgId,ids[0]]));expect(oldest.rows[0]).toEqual({artifact_state:'cleanup_pending',retention_evicted:true});
  });

  it('serializes actor-wide admission across different Boards',async()=>{
    const racer=actor('wb-4052-racer');await addOrgMember(orgId,racer.userId,'consultant',null);expect(await boards.putMember(owner,boardId,{userId:racer.userId,role:'editor'})).toBe(true);expect(await boards.putMember(owner,secondBoardId,{userId:racer.userId,role:'editor'})).toBe(true);
    const settled=await Promise.allSettled(Array.from({length:21},(_,index)=>{const initial=queued('png',index%2?boardId:secondBoardId);return jobs.create(racer,initial,{format:'png',background:'#ffffff'});}));expect(settled.filter(result=>result.status==='fulfilled')).toHaveLength(20);expect(settled.filter(result=>result.status==='rejected')).toHaveLength(1);
    const retained=await asApp(orgId,c=>c.query<{count:string}>(`SELECT count(*)::text count FROM whiteboard_file_export_jobs WHERE org_id=$1 AND actor_id=$2 AND NOT retention_evicted`,[orgId,racer.userId]));expect(Number(retained.rows[0]?.count)).toBe(20);
  });
});
