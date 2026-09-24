import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let db:PGlite;
const checkpointMigration=new URL('../../migrations/20260924000300_whiteboard_checkpoints.sql',import.meta.url);
const permissionMigration=new URL('../../migrations/20260924001200_whiteboard_checkpoint_retention_delete.sql',import.meta.url);
const boardA='11111111-1111-4111-8111-111111111111',boardB='22222222-2222-4222-8222-222222222222';
const checkpoint=(org:string,board:string,id:string,state:'active'|'pinned',retention:string)=>`(
  '${org}','${board}','${id}','actor','${id}','${'a'.repeat(64)}','label','reason',1,0,'${'b'.repeat(64)}',
  'tenants/${org}/checkpoint/sha256/${'c'.repeat(64)}',1,'${'c'.repeat(64)}','${'d'.repeat(64)}',10,0,
  '${retention}'::timestamptz,'${state}')`;

beforeEach(async()=>{
  db=await PGlite.create();
  await db.exec(`
    CREATE ROLE app_rw;
    CREATE FUNCTION kernel_apply_org_freeze_policies() RETURNS void LANGUAGE sql AS 'SELECT NULL::void';
    CREATE TABLE whiteboard_documents(org_id text NOT NULL,board_id uuid NOT NULL,PRIMARY KEY(org_id,board_id));
    INSERT INTO whiteboard_documents VALUES ('org-a','${boardA}'),('org-b','${boardB}');
  `);
  await db.exec(await readFile(checkpointMigration,'utf8'));
  await db.exec(await readFile(permissionMigration,'utf8'));
  await db.exec(`INSERT INTO whiteboard_checkpoints(
    org_id,board_id,checkpoint_id,actor_id,request_id,request_hash,label,reason,epoch,seq,head_manifest_digest,
    blob_key,blob_version,cipher_sha256,content_sha256,size_bytes,object_count,retention_until,retention_state
  ) VALUES
    ${checkpoint('org-a',boardA,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','active','2020-01-01')},
    ${checkpoint('org-a',boardA,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','active','2099-01-01')},
    ${checkpoint('org-a',boardA,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','pinned','2020-01-01')},
    ${checkpoint('org-b',boardB,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','active','2020-01-01')};`);
});
afterEach(async()=>db.close());

describe('whiteboard checkpoint retention delete permission',()=>{
  it('lets app_rw delete only expired active rows in its current tenant',async()=>{
    await db.exec(`SET ROLE app_rw; SET app.current_org='org-a';`);
    const deleted=await db.query<{checkpoint_id:string}>(`DELETE FROM whiteboard_checkpoints
      WHERE org_id='org-a' AND retention_state='active' AND retention_until<='2025-01-01' RETURNING checkpoint_id::text`);
    expect(deleted.rows).toEqual([{checkpoint_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'}]);
    const visible=await db.query<{checkpoint_id:string;retention_state:string}>(`SELECT checkpoint_id::text,retention_state FROM whiteboard_checkpoints ORDER BY checkpoint_id`);
    expect(visible.rows).toEqual([
      {checkpoint_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',retention_state:'active'},
      {checkpoint_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',retention_state:'pinned'},
    ]);
    const crossTenant=await db.query(`DELETE FROM whiteboard_checkpoints WHERE org_id='org-b' RETURNING checkpoint_id`);
    expect(crossTenant.rows).toEqual([]);
    const protectedRows=await db.query(`DELETE FROM whiteboard_checkpoints
      WHERE checkpoint_id IN ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3') RETURNING checkpoint_id`);
    expect(protectedRows.rows).toEqual([]);
  });

  it('does not grant delete on immutable restore receipts',async()=>{
    await db.exec(await readFile(checkpointMigration,'utf8'));
    await db.exec(await readFile(permissionMigration,'utf8'));
    const privilege=await db.query<{checkpoint_delete:boolean;restore_delete:boolean}>(`SELECT
      has_table_privilege('app_rw','whiteboard_checkpoints','DELETE') checkpoint_delete,
      has_table_privilege('app_rw','whiteboard_checkpoint_restores','DELETE') restore_delete`);
    expect(privilege.rows).toEqual([{checkpoint_delete:true,restore_delete:false}]);
    const policies=await db.query<{policyname:string;cmd:string}>(`SELECT policyname,cmd FROM pg_policies WHERE tablename='whiteboard_checkpoints' ORDER BY policyname`);
    expect(policies.rows).toEqual([
      {policyname:'whiteboard_checkpoints_tenant_insert',cmd:'INSERT'},
      {policyname:'whiteboard_checkpoints_tenant_retention_delete',cmd:'DELETE'},
      {policyname:'whiteboard_checkpoints_tenant_select',cmd:'SELECT'},
    ]);
  });
});
