import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabasePort, QueryResult, TenantSession } from '../../src/application/ports/database.port';
import { WhiteboardRecoveryError } from '../../src/application/whiteboard/ports';
import { toOrgId } from '../../src/domain/org-id';
import type { Principal } from '../../src/domain/principal';
import { PgWhiteboardRepository } from '../../src/infrastructure/whiteboard/pg-whiteboard-repository';

const legacyMigration = readFileSync(
  fileURLToPath(new URL('../../migrations/20260924000500_whiteboard_quarantine_recovery.sql', import.meta.url)),
  'utf8',
);
const proofMigration = readFileSync(
  fileURLToPath(new URL('../../migrations/20260924000600_whiteboard_quarantine_access_proofs.sql', import.meta.url)),
  'utf8',
);

const orgId = toOrgId('pglite-recovery-a');
const otherOrgId = toOrgId('pglite-recovery-b');
const boardId = '11111111-1111-4111-8111-111111111111';
const owner: Principal = { orgId, userId: 'owner' };
const editor: Principal = { orgId, userId: 'editor' };
const outsider: Principal = { orgId: otherOrgId, userId: 'editor' };
const legacyRequestId = '22222222-2222-4222-8222-222222222222';

class PGliteTenantDatabase implements DatabasePort {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly database: PGlite) {}

  private enqueue<T>(org: string | null, run: (session: TenantSession) => Promise<T>): Promise<T> {
    const task = this.tail.then(async () => {
      await this.database.exec('BEGIN');
      try {
        await this.database.exec('SET LOCAL ROLE app_rw');
        if (org !== null) await this.database.query("SELECT set_config('app.current_org',$1,true)", [org]);
        const session: TenantSession = {
          query: async <R>(sql: string, params: readonly unknown[] = []) => {
            const result = await this.database.query<R>(sql, [...params]);
            return { rows: result.rows } as QueryResult<R>;
          },
        };
        const result=await run(session);
        await this.database.exec('COMMIT');
        return result;
      } catch(error) {
        await this.database.exec('ROLLBACK');
        throw error;
      }
    });
    this.tail = task.catch(() => undefined);
    return task;
  }

  withTenant<T>(org: typeof orgId, run: (session: TenantSession) => Promise<T>): Promise<T> {
    return this.enqueue(org, run);
  }
  withoutTenant<T>(run: (session: TenantSession) => Promise<T>): Promise<T> {
    return this.enqueue(null, run);
  }
  async close(): Promise<void> { await this.database.close(); }
}

let database: PGlite;
let port: PGliteTenantDatabase;
let repository: PgWhiteboardRepository;
const scheduledOrgs:string[]=[];
const maintenance={ensureScheduled:async(_session:TenantSession,org:string)=>{scheduledOrgs.push(org);}};

beforeAll(async () => {
  database = await PGlite.create();
  await database.exec(`
    CREATE ROLE app_rw;
    CREATE TABLE organizations(id text PRIMARY KEY, status text NOT NULL DEFAULT 'active');
    CREATE TABLE org_memberships(org_id text NOT NULL, user_id text NOT NULL, PRIMARY KEY(org_id,user_id));
    CREATE TABLE whiteboards(
      org_id text NOT NULL, id uuid NOT NULL, owner_id text NOT NULL,
      PRIMARY KEY(org_id,id)
    );
    CREATE TABLE whiteboard_members(
      org_id text NOT NULL, board_id uuid NOT NULL, user_id text NOT NULL, role text NOT NULL,
      PRIMARY KEY(org_id,board_id,user_id)
    );
    CREATE FUNCTION kernel_apply_org_freeze_policies() RETURNS void LANGUAGE sql AS $$ SELECT $$;
    GRANT SELECT ON organizations,org_memberships,whiteboards,whiteboard_members TO app_rw;
    GRANT UPDATE ON whiteboards TO app_rw;
  `);
  await database.exec(legacyMigration);
  await database.query('INSERT INTO organizations(id) VALUES($1),($2)', [orgId, otherOrgId]);
  await database.query(
    "INSERT INTO org_memberships(org_id,user_id) VALUES($1,'owner'),($1,'editor'),($2,'editor')",
    [orgId, otherOrgId],
  );
  await database.query('INSERT INTO whiteboards(org_id,id,owner_id) VALUES($1,$2,\'owner\')', [orgId, boardId]);
  await database.query(
    "INSERT INTO whiteboard_members(org_id,board_id,user_id,role) VALUES($1,$2,'editor','editor')",
    [orgId, boardId],
  );
  await database.query(
    `INSERT INTO whiteboard_quarantine_recovery_requests
      (org_id,board_id,request_id,receipt_id,requested_by,session_fingerprint,epoch,pending_count,pending_bytes,reason,status)
     VALUES($1,$2,$3,$4,'editor',$5,1,1,1,'ACCESS_DENIED','pending-review')`,
    [orgId, boardId, legacyRequestId, randomUUID(), 'f'.repeat(64)],
  );
  await database.exec(proofMigration);
  await database.exec(legacyMigration);
  await database.exec(proofMigration);
  port = new PGliteTenantDatabase(database);
  repository = new PgWhiteboardRepository(port,maintenance);
});

afterAll(async () => { await port?.close(); });

describe('whiteboard quarantine recovery on an executable PostgreSQL engine', () => {
  it('upgrades legacy rows as denied audit history and replays the migration', async () => {
    const result = await database.query<{ status: string; request_hash: string; access_receipt_id: string | null }>(
      `SELECT status,request_hash,access_receipt_id FROM whiteboard_quarantine_recovery_requests
       WHERE request_id=$1`,
      [legacyRequestId],
    );
    expect(result.rows).toEqual([{ status: 'denied', request_hash: '0'.repeat(64), access_receipt_id: null }]);
  });

  it('reuses a single receipt for the same principal session and hides it across tenants', async () => {
    const fingerprint = 'a'.repeat(64);
    const receipts = await Promise.all(
      Array.from({ length: 8 }, () => repository.issueQuarantineAccessReceipt(editor, boardId, fingerprint, 1)),
    );
    expect(new Set(receipts).size).toBe(1);
    expect(await repository.issueQuarantineAccessReceipt(editor, boardId, fingerprint, 1)).toBe(receipts[0]);
    expect(scheduledOrgs).toEqual([orgId]);
    const own = await port.withTenant(orgId, session => session.query<{ count: string }>(
      `SELECT count(*)::text count FROM whiteboard_quarantine_access_receipts
       WHERE board_id=$1 AND actor_id=$2 AND session_fingerprint=$3 AND epoch=1`,
      [boardId, editor.userId, fingerprint],
    ));
    expect(own.rows[0]?.count).toBe('1');
    const hidden = await port.withTenant(otherOrgId, session => session.query(
      'SELECT receipt_id FROM whiteboard_quarantine_access_receipts',
    ));
    expect(hidden.rows).toEqual([]);
  });

  it('rolls receipt issuance back when persistent maintenance registration fails',async()=>{
    const failedFingerprint='9'.repeat(64);
    const unavailable=new PgWhiteboardRepository(port,{
      ensureScheduled:async()=>{throw new Error('maintenance unavailable');},
    });
    await expect(unavailable.issueQuarantineAccessReceipt(editor,boardId,failedFingerprint,1))
      .rejects.toThrow('maintenance unavailable');
    const rows=await port.withTenant(orgId,session=>session.query(
      'SELECT receipt_id FROM whiteboard_quarantine_access_receipts WHERE session_fingerprint=$1',[failedFingerprint],
    ));
    expect(rows.rows).toEqual([]);
  });

  it('accepts a genuine historical proof once, exactly replays it, and rejects changed or forged inputs', async () => {
    const fingerprint = 'b'.repeat(64);
    const accessReceiptId = await repository.issueQuarantineAccessReceipt(editor, boardId, fingerprint, 1);
    await database.query('DELETE FROM whiteboard_members WHERE org_id=$1 AND board_id=$2 AND user_id=$3', [orgId, boardId, editor.userId]);
    const request = {
      requestId: randomUUID(), receiptId: randomUUID(), accessReceiptId, sessionFingerprint: fingerprint,
      epoch: 1, pendingCount: 3, pendingBytes: 12, reason: 'ACCESS_DENIED' as const,
    };
    const first = await repository.requestQuarantineRecovery(editor, boardId, request);
    expect(first).toMatchObject({ requestId: request.requestId, status: 'pending-review' });
    await expect(repository.requestQuarantineRecovery(editor, boardId, request)).resolves.toEqual(first);
    await expect(repository.requestQuarantineRecovery(editor, boardId, { ...request, pendingBytes: 13 }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' } satisfies Partial<WhiteboardRecoveryError>);
    await expect(repository.requestQuarantineRecovery(editor, boardId, { ...request, requestId: randomUUID() }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(repository.requestQuarantineRecovery(editor, boardId, {
      ...request, requestId: randomUUID(), receiptId: randomUUID(), accessReceiptId: randomUUID(),
    })).resolves.toBeNull();
    await expect(repository.requestQuarantineRecovery(outsider, boardId, {
      ...request, requestId: randomUUID(), receiptId: randomUUID(),
    })).resolves.toBeNull();
    const consumed = await port.withTenant(orgId, session => session.query<{ active: boolean; consumed_at: Date | null;inactive_at:Date|null }>(
      'SELECT active,consumed_at,inactive_at FROM whiteboard_quarantine_access_receipts WHERE receipt_id=$1',
      [accessReceiptId],
    ));
    expect(consumed.rows[0]).toMatchObject({ active: false, consumed_at: expect.any(Date),inactive_at:expect.any(Date) });
  });

  it('rejects an expired receipt with the same non-enumerating empty result', async () => {
    await database.query(
      `INSERT INTO whiteboard_members(org_id,board_id,user_id,role)
       VALUES($1,$2,$3,'editor') ON CONFLICT(org_id,board_id,user_id) DO UPDATE SET role=EXCLUDED.role`,
      [orgId, boardId, editor.userId],
    );
    const fingerprint = 'c'.repeat(64);
    const accessReceiptId = await repository.issueQuarantineAccessReceipt(editor, boardId, fingerprint, 1);
    await database.query(
      `UPDATE whiteboard_quarantine_access_receipts
       SET issued_at=now()-interval '2 days',expires_at=now()-interval '1 day'
       WHERE org_id=$1 AND receipt_id=$2`,
      [orgId, accessReceiptId],
    );
    await expect(repository.requestQuarantineRecovery(editor, boardId, {
      requestId: randomUUID(), receiptId: randomUUID(), accessReceiptId, sessionFingerprint: fingerprint,
      epoch: 1, pendingCount: 1, pendingBytes: 1, reason: 'ACCESS_DENIED',
    })).resolves.toBeNull();
    const expired=await port.withTenant(orgId,session=>session.query<{active:boolean;expires_at:Date;inactive_at:Date}>(
      'SELECT active,expires_at,inactive_at FROM whiteboard_quarantine_access_receipts WHERE receipt_id=$1',[accessReceiptId],
    ));
    expect(expired.rows[0]?.active).toBe(false);
    expect(new Date(expired.rows[0]!.inactive_at).toISOString()).toBe(new Date(expired.rows[0]!.expires_at).toISOString());
  });

  it('rejects issuance after committed revocation and cleans retention from inactive_at while preserving audit proofs',async()=>{
    const orphan=await repository.issueQuarantineAccessReceipt(editor,boardId,'d'.repeat(64),1);
    const referenced=await database.query<{access_receipt_id:string}>(
      'SELECT access_receipt_id FROM whiteboard_quarantine_recovery_requests WHERE status=\'pending-review\' LIMIT 1',
    );
    await database.query(`UPDATE whiteboard_quarantine_access_receipts SET active=false,inactive_at=now()-interval '91 days'
      WHERE receipt_id=$1 OR receipt_id=$2`,[orphan,referenced.rows[0]!.access_receipt_id]);
    await expect(repository.cleanupQuarantineAccessReceipts(owner)).resolves.toBe(1);
    const retained=await port.withTenant(orgId,session=>session.query<{receipt_id:string}>(
      'SELECT receipt_id FROM whiteboard_quarantine_access_receipts WHERE receipt_id=$1 OR receipt_id=$2 ORDER BY receipt_id',
      [orphan,referenced.rows[0]!.access_receipt_id],
    ));
    expect(retained.rows.map(row=>row.receipt_id)).toEqual([referenced.rows[0]!.access_receipt_id]);
    await database.query('DELETE FROM whiteboard_members WHERE org_id=$1 AND board_id=$2 AND user_id=$3',[orgId,boardId,editor.userId]);
    await expect(repository.issueQuarantineAccessReceipt(editor,boardId,'e'.repeat(64),1)).rejects.toThrow('WHITEBOARD_ACCESS_CHANGED');
  });
});
