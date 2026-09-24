import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgDatabase } from '../../src/infrastructure/db/pg-database';
import { appConfig } from '../../src/infrastructure/db/pg-config';
import { PgWhiteboardRepository } from '../../src/infrastructure/whiteboard/pg-whiteboard-repository';
import { WhiteboardRecoveryError } from '../../src/application/whiteboard/ports';
import { toOrgId } from '../../src/domain/org-id';
import type { Principal } from '../../src/domain/principal';
import { addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from '../support/db';

const orgId=toOrgId('wb-recovery-3972-a'),otherOrg=toOrgId('wb-recovery-3972-b');
const owner:Principal={orgId,userId:'wb-recovery-owner'};
const editor:Principal={orgId,userId:'wb-recovery-editor'};
const colleague:Principal={orgId,userId:'wb-recovery-colleague'};
const outsider:Principal={orgId:otherOrg,userId:'wb-recovery-editor'};
const fingerprint='a'.repeat(64);
let db:PgDatabase,repo:PgWhiteboardRepository,boardId:string,accessReceiptId:string,expiredAccessReceiptId:string;

const input=(overrides:Partial<Parameters<PgWhiteboardRepository['requestQuarantineRecovery']>[2]>={})=>({
  requestId:randomUUID(),receiptId:randomUUID(),accessReceiptId,sessionFingerprint:fingerprint,
  epoch:1,pendingCount:3,pendingBytes:12,reason:'ACCESS_DENIED' as const,...overrides,
});

beforeAll(async()=>{
  ensureDatabase();await migrateOnce();await resetOrgs(orgId,otherOrg);
  await seedOrg({orgId,projectId:'wb-recovery-project-a'});await seedOrg({orgId:otherOrg,projectId:'wb-recovery-project-b'});
  for(const principal of [owner,editor,colleague,outsider])await addOrgMember(principal.orgId,principal.userId,'consultant',null);
  db=new PgDatabase(appConfig());repo=new PgWhiteboardRepository(db);
  const board=await repo.create(owner,{requestId:randomUUID(),name:'隔离恢复'});boardId=board.id;
  await repo.putMember(owner,boardId,{userId:editor.userId,role:'editor'});
  const concurrentlyIssued=await Promise.all(Array.from({length:8},()=>repo.issueQuarantineAccessReceipt(editor,boardId,fingerprint,1)));
  expect(new Set(concurrentlyIssued).size).toBe(1);accessReceiptId=concurrentlyIssued[0]!;
  expiredAccessReceiptId=await repo.issueQuarantineAccessReceipt(editor,boardId,'b'.repeat(64),1);
  await asOwner(c=>c.query(`UPDATE whiteboard_quarantine_access_receipts
    SET issued_at=now()-interval '2 days',expires_at=now()-interval '1 day'
    WHERE org_id=$1 AND receipt_id=$2`,[orgId,expiredAccessReceiptId]).then(()=>undefined));
  await repo.removeMember(owner,boardId,editor.userId);
});
afterAll(async()=>{await db?.close();await resetOrgs(orgId,otherOrg);});

describe('whiteboard quarantine recovery on real PostgreSQL',()=>{
  it('replays only an exact request and persists a canonical audit digest after access was revoked',async()=>{
    const request=input(),first=await repo.requestQuarantineRecovery(editor,boardId,request);
    expect(first).toMatchObject({requestId:request.requestId,status:'pending-review'});
    await expect(repo.requestQuarantineRecovery(editor,boardId,request)).resolves.toEqual(first);
    await expect(repo.requestQuarantineRecovery(editor,boardId,{...request,pendingBytes:13})).rejects.toMatchObject({name:'WhiteboardRecoveryError',code:'IDEMPOTENCY_CONFLICT'} satisfies Partial<WhiteboardRecoveryError>);
    await expect(repo.requestQuarantineRecovery(editor,boardId,{...request,requestId:randomUUID()})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
    const rows=await asApp(orgId,c=>c.query<{request_hash:string;access_receipt_id:string;requested_by:string}>(`SELECT request_hash,access_receipt_id,requested_by FROM whiteboard_quarantine_recovery_requests WHERE org_id=$1 AND request_id=$2`,[orgId,request.requestId]));
    expect(rows.rows).toEqual([{request_hash:expect.stringMatching(/^[a-f0-9]{64}$/),access_receipt_id:accessReceiptId,requested_by:editor.userId}]);
    const consumed=await asApp(orgId,c=>c.query<{active:boolean;consumed_at:Date|null}>(`SELECT active,consumed_at FROM whiteboard_quarantine_access_receipts WHERE org_id=$1 AND receipt_id=$2`,[orgId,accessReceiptId]));
    expect(consumed.rows[0]).toMatchObject({active:false,consumed_at:expect.any(Date)});
  });

  it('returns the same empty result for forged, never-authorized and cross-tenant proofs',async()=>{
    await expect(repo.requestQuarantineRecovery(editor,boardId,input({accessReceiptId:randomUUID()}))).resolves.toBeNull();
    await expect(repo.requestQuarantineRecovery(editor,boardId,input({accessReceiptId:expiredAccessReceiptId,sessionFingerprint:'b'.repeat(64)}))).resolves.toBeNull();
    await expect(repo.requestQuarantineRecovery(colleague,boardId,input())).resolves.toBeNull();
    await expect(repo.requestQuarantineRecovery(outsider,boardId,input())).resolves.toBeNull();
    const hidden=await asApp(otherOrg,c=>c.query(`SELECT receipt_id FROM whiteboard_quarantine_access_receipts WHERE org_id=$1`,[orgId]));
    expect(hidden.rows).toEqual([]);
  });

  it('reuses one active receipt across sequential and concurrent reconnects',async()=>{
    await repo.putMember(owner,boardId,{userId:editor.userId,role:'editor'});
    const reconnectFingerprint='c'.repeat(64);
    const issued=await Promise.all(Array.from({length:8},()=>repo.issueQuarantineAccessReceipt(editor,boardId,reconnectFingerprint,1)));
    expect(new Set(issued).size).toBe(1);
    expect(await repo.issueQuarantineAccessReceipt(editor,boardId,reconnectFingerprint,1)).toBe(issued[0]);
    const count=await asApp(orgId,c=>c.query<{count:string}>(`SELECT count(*)::text count FROM whiteboard_quarantine_access_receipts
      WHERE org_id=$1 AND board_id=$2 AND actor_id=$3 AND session_fingerprint=$4 AND epoch=1 AND active=true`,[orgId,boardId,editor.userId,reconnectFingerprint]));
    expect(count.rows[0]?.count).toBe('1');
    await repo.removeMember(owner,boardId,editor.userId);
  });

  it('keeps migration replay idempotent through the production migrator',async()=>{
    await migrateOnce();
    const objects=await asApp(orgId,c=>c.query<{access_table:string|null;request_table:string|null}>(`SELECT
      to_regclass('public.whiteboard_quarantine_access_receipts')::text access_table,
      to_regclass('public.whiteboard_quarantine_recovery_requests')::text request_table`));
    expect(objects.rows[0]).toEqual({access_table:'whiteboard_quarantine_access_receipts',request_table:'whiteboard_quarantine_recovery_requests'});
  });
});
