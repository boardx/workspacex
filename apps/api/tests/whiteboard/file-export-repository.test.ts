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
let db:PgDatabase,jobs:PgWhiteboardFileExportRepository,boards:PgWhiteboardRepository,boardId:string;
const queued=(format:C.BoardFileExportFormat='png')=>C.BoardFileExportStatus.parse({jobId:randomUUID(),boardId,format,status:'queued',progress:0,filename:`board.${format==='sticky-csv'?'csv':format}`,mimeType:format==='png'?'image/png':format==='svg'?'image/svg+xml':format==='pdf'?'application/pdf':'text/csv; charset=utf-8',objectCount:0,pageOrder:[],losses:[],sizeBytes:null,errorCode:null});

beforeAll(async()=>{
  ensureDatabase();await migrateOnce();await resetOrgs(orgId,otherOrg);
  await seedOrg({orgId,projectId:'wb-4052-project-a'});await seedOrg({orgId:otherOrg,projectId:'wb-4052-project-b'});
  for(const principal of [owner,editor,viewer,crossTenantSameUser])await addOrgMember(principal.orgId,principal.userId,'consultant',null);
  db=new PgDatabase(appConfig());jobs=new PgWhiteboardFileExportRepository(db);boards=new PgWhiteboardRepository(db);
  const board=await boards.create(owner,{requestId:randomUUID(),name:'Export security'});boardId=board.id;
  expect(await boards.putMember(owner,boardId,{userId:editor.userId,role:'editor'})).toBe(true);
  expect(await boards.putMember(owner,boardId,{userId:viewer.userId,role:'viewer'})).toBe(true);
});
afterAll(async()=>{await db?.close();await resetOrgs(orgId,otherOrg);});

async function complete(principal:Principal){
  const initial=queued();await jobs.create(principal,initial,{format:'png',background:'#ffffff'});await jobs.running(principal,initial.jobId,40);
  const bytes=new TextEncoder().encode('real immutable artifact'),sha=createHash('sha256').update(bytes).digest('hex');
  const done=C.BoardFileExportStatus.parse({...initial,status:'done',progress:100,objectCount:3,pageOrder:['frame'],sizeBytes:bytes.length,errorCode:null});
  await jobs.complete(principal,done,`whiteboard-exports/${principal.orgId}/${initial.jobId}.png`,sha);
  return{initial,done,sha};
}

describe('Board file export repository on real PostgreSQL',()=>{
  it.each([['owner',owner],['editor',editor],['viewer',viewer]] as const)('persists an authorized %s create → running → complete → find lifecycle',async(_role,principal)=>{
    const {initial,done,sha}=await complete(principal),found=await jobs.find(principal,initial.jobId);
    expect(found).toEqual({status:done,objectKey:`whiteboard-exports/${principal.orgId}/${initial.jobId}.png`,sha256:sha});
  });

  it('hides status and locators after membership revocation and refuses cancellation',async()=>{
    const initial=queued('pdf');await jobs.create(viewer,initial,{format:'pdf',background:'transparent'});await jobs.running(viewer,initial.jobId,40);
    expect(await boards.removeMember(owner,boardId,viewer.userId)).toBe(true);
    expect(await jobs.find(viewer,initial.jobId)).toBeNull();expect(await jobs.cancel(viewer,initial.jobId)).toBeNull();
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
});
