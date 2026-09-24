import { createHash, randomUUID } from 'node:crypto';
import { whiteboard as C } from '@repo/contracts';
import type { Principal } from '../../domain/principal';
import type { DatabasePort, TenantSession } from '../../application/ports/database.port';
import { WhiteboardRecoveryError, type WhiteboardRepository, type CreateBoard, type UpdateBoard, type Member, type WhiteboardReceiptMaintenance } from '../../application/whiteboard/ports';
import { WHITEBOARD_RECOVERY_POLICY } from '../../domain/whiteboard-recovery-policy';

type Row = { id: string; name: string; owner_id: string; role: string; archived: boolean; created_at: Date; updated_at: Date };
const columns = `b.id, b.name, b.owner_id, b.archived, b.created_at, b.updated_at,
 CASE WHEN b.owner_id = $2 THEN 'owner' ELSE m.role END AS role`;
const membership = `LEFT JOIN whiteboard_members m ON m.org_id=b.org_id AND m.board_id=b.id AND m.user_id=$2`;
const visible = `(b.owner_id=$2 OR m.user_id IS NOT NULL)`;
function view(r: Row): C.Board {
  return C.Board.parse({ id: r.id, name: r.name, ownerId: r.owner_id, role: r.role, archived: r.archived,
    createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString() });
}
function recoveryHash(boardId: string, input: C.RequestQuarantineRecovery): string {
  return createHash('sha256').update(JSON.stringify({
    boardId,
    requestId: input.requestId,
    receiptId: input.receiptId,
    accessReceiptId: input.accessReceiptId,
    sessionFingerprint: input.sessionFingerprint,
    epoch: input.epoch,
    pendingCount: input.pendingCount,
    pendingBytes: input.pendingBytes,
    reason: input.reason,
  })).digest('hex');
}
export async function cleanupAccessReceipts(s:TenantSession,orgId:string):Promise<number>{
  // Expiry is the logical inactive instant even when maintenance runs later. Consumed proofs use
  // their actual consumption clock, so retention never silently includes the preceding TTL.
  await s.query(`UPDATE whiteboard_quarantine_access_receipts SET active=false,inactive_at=COALESCE(inactive_at,expires_at)
    WHERE org_id=$1 AND active=true AND expires_at<=now()`,[orgId]);
  const deleted=await s.query<{receipt_id:string}>(`DELETE FROM whiteboard_quarantine_access_receipts ar
    WHERE ar.org_id=$1 AND ar.active=false
      AND ar.inactive_at<now()-($2::bigint * interval '1 millisecond')
      AND NOT EXISTS (SELECT 1 FROM whiteboard_quarantine_recovery_requests rr
        WHERE rr.org_id=ar.org_id AND rr.access_receipt_id=ar.receipt_id)
    RETURNING ar.receipt_id`,[orgId,WHITEBOARD_RECOVERY_POLICY.inactiveReceiptRetentionMs]);
  return deleted.rows.length;
}
/** All SQL is tenant-scoped and actor-filtered. A resource ID never grants access. */
export class PgWhiteboardRepository implements WhiteboardRepository {
  constructor(private readonly db: DatabasePort,
    private readonly receiptMaintenance?:Pick<WhiteboardReceiptMaintenance,'ensureScheduled'>) {}
  async list(p: Principal): Promise<C.Board[]> {
    return this.db.withTenant(p.orgId, async s => {
      const r = await s.query<Row>(`SELECT ${columns} FROM whiteboards b ${membership}
        WHERE b.org_id=$1 AND ${visible} ORDER BY b.updated_at DESC, b.id LIMIT 500`, [p.orgId, p.userId]);
      return r.rows.map(view);
    });
  }
  async create(p: Principal, input: CreateBoard): Promise<C.Board> {
    return this.db.withTenant(p.orgId, async s => {
      // A concurrent replay blocks on the unique key then reads the committed original.
      await s.query(`INSERT INTO whiteboards(id,org_id,owner_id,request_id,name) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(org_id,owner_id,request_id) DO NOTHING`, [randomUUID(),p.orgId,p.userId,input.requestId,input.name]);
      const r = await s.query<Row>(`SELECT b.*, 'owner' AS role FROM whiteboards b WHERE org_id=$1 AND owner_id=$2 AND request_id=$3`, [p.orgId,p.userId,input.requestId]);
      return view(r.rows[0]!);
    });
  }
  async get(p: Principal, id: string): Promise<C.Board | null> {
    return this.db.withTenant(p.orgId, async s => {
      const r = await s.query<Row>(`SELECT ${columns} FROM whiteboards b ${membership} WHERE b.org_id=$1 AND b.id=$3 AND ${visible}`, [p.orgId,p.userId,id]);
      return r.rows[0] ? view(r.rows[0]) : null;
    });
  }
  async update(p: Principal, id: string, input: UpdateBoard): Promise<C.Board | null> {
    return this.db.withTenant(p.orgId, async s => {
      const r = await s.query<Row>(`UPDATE whiteboards SET name=COALESCE($4,name), archived=COALESCE($5,archived), updated_at=now()
        WHERE org_id=$1 AND owner_id=$2 AND id=$3 RETURNING *, 'owner' AS role`, [p.orgId,p.userId,id,input.name ?? null,input.archived ?? null]);
      return r.rows[0] ? view(r.rows[0]) : null;
    });
  }
  async members(p: Principal, id: string): Promise<Member[] | null> {
    return this.db.withTenant(p.orgId, async s => {
      const board = await s.query(`SELECT id FROM whiteboards WHERE org_id=$1 AND owner_id=$2 AND id=$3 FOR SHARE`, [p.orgId,p.userId,id]);
      if (!board.rows.length) return null;
      const r = await s.query<{user_id: string; role: string}>(`SELECT user_id,role FROM whiteboard_members WHERE org_id=$1 AND board_id=$2 ORDER BY user_id`, [p.orgId,id]);
      return r.rows.map(r => C.Member.parse({ userId:r.user_id,role:r.role }));
    });
  }
  async putMember(p: Principal, id: string, member: Member): Promise<boolean> {
    return this.db.withTenant(p.orgId, async s => {
      // Serialize permission changes with collaborative writes on the board row.
      const owner = await s.query(`SELECT id FROM whiteboards WHERE org_id=$1 AND owner_id=$2 AND id=$3 FOR UPDATE`, [p.orgId,p.userId,id]);
      if (!owner.rows.length) return false;
      // Owner is immutable through member operations; target must belong to this tenant.
      const r = await s.query(`INSERT INTO whiteboard_members(org_id,board_id,user_id,role)
        SELECT b.org_id,b.id,$4,$5 FROM whiteboards b
        JOIN org_memberships om ON om.org_id=b.org_id AND om.user_id=$4
        WHERE b.org_id=$1 AND b.owner_id=$2 AND b.id=$3 AND b.owner_id<>$4
        ON CONFLICT(org_id,board_id,user_id) DO UPDATE SET role=EXCLUDED.role RETURNING user_id`, [p.orgId,p.userId,id,member.userId,member.role]);
      return r.rows.length > 0;
    });
  }
  async removeMember(p: Principal, id: string, userId: string): Promise<boolean> {
    return this.db.withTenant(p.orgId, async s => {
      const owner = await s.query(`SELECT id FROM whiteboards WHERE org_id=$1 AND owner_id=$2 AND id=$3 FOR UPDATE`,[p.orgId,p.userId,id]);
      if (!owner.rows.length || userId===p.userId) return false;
      await s.query(`DELETE FROM whiteboard_members WHERE org_id=$1 AND board_id=$2 AND user_id=$3`,[p.orgId,id,userId]);
      return true;
    });
  }
  async cleanupQuarantineAccessReceipts(p:Principal):Promise<number>{
    return this.db.withTenant(p.orgId,s=>cleanupAccessReceipts(s,p.orgId));
  }
  async issueQuarantineAccessReceipt(p: Principal, id: string, sessionFingerprint: string, epoch: number): Promise<string> {
    const fingerprint = /^[a-f0-9]{64}$/.test(sessionFingerprint);
    if (!fingerprint || !Number.isSafeInteger(epoch) || epoch < 1) throw new Error('WHITEBOARD_ACCESS_CHANGED');
    return this.db.withTenant(p.orgId, async s => {
      // The same board-row lock orders receipt issuance after committed membership changes.
      const board=await s.query(`SELECT id FROM whiteboards WHERE org_id=$1 AND id=$2 FOR UPDATE`,[p.orgId,id]);
      if(!board.rows.length)throw new Error('WHITEBOARD_ACCESS_CHANGED');
      await cleanupAccessReceipts(s,p.orgId);
      const expiresAt=new Date(Date.now()+WHITEBOARD_RECOVERY_POLICY.accessReceiptTtlMs);
      const receiptId=randomUUID();
      const issued = await s.query<{receipt_id:string}>(`INSERT INTO whiteboard_quarantine_access_receipts
        (org_id,board_id,receipt_id,actor_id,session_fingerprint,epoch,expires_at)
        SELECT b.org_id,b.id,$4,$2,$5,$6,$7 FROM whiteboards b
        LEFT JOIN whiteboard_members m ON m.org_id=b.org_id AND m.board_id=b.id AND m.user_id=$2
        WHERE b.org_id=$1 AND b.id=$3 AND (b.owner_id=$2 OR m.role IN ('editor','viewer'))
        ON CONFLICT (org_id,board_id,actor_id,session_fingerprint,epoch) WHERE active
        DO UPDATE SET expires_at=GREATEST(whiteboard_quarantine_access_receipts.expires_at,EXCLUDED.expires_at)
        RETURNING receipt_id`, [p.orgId,p.userId,id,receiptId,sessionFingerprint,epoch,expiresAt]);
      const row=issued.rows[0];
      if(!row) throw new Error('WHITEBOARD_ACCESS_CHANGED');
      // Register the persistent singleton cron in the same transaction as the first receipt.
      // A deployment without the maintenance worker fails this issuance instead of silently
      // accumulating metadata forever.
      if(!this.receiptMaintenance)throw new Error('WHITEBOARD_RECEIPT_MAINTENANCE_UNAVAILABLE');
      await this.receiptMaintenance.ensureScheduled(s,p.orgId);
      return row.receipt_id;
    });
  }
  async requestQuarantineRecovery(p: Principal, id: string, input: C.RequestQuarantineRecovery): Promise<C.QuarantineRecoveryRequest | null> {
    return this.db.withTenant(p.orgId, async s => {
      await cleanupAccessReceipts(s,p.orgId);
      const hash=recoveryHash(id,input);
      type RecoveryRow={request_id:string;request_hash:string;status:'pending-review'|'denied';created_at:Date};
      const lookup=()=>s.query<RecoveryRow>(`SELECT request_id,request_hash,status,created_at
        FROM whiteboard_quarantine_recovery_requests
        WHERE org_id=$1 AND requested_by=$2 AND (request_id=$3 OR receipt_id=$4 OR access_receipt_id=$5)
        FOR UPDATE`,[p.orgId,p.userId,input.requestId,input.receiptId,input.accessReceiptId]);
      const project=(row:RecoveryRow)=>C.QuarantineRecoveryRequest.parse({requestId:row.request_id,status:row.status,createdAt:new Date(row.created_at).toISOString()});
      const replay=await lookup();
      if(replay.rows.length){
        const row=replay.rows.find(value=>value.request_id===input.requestId&&value.request_hash===hash);
        if(replay.rows.length!==1||!row)throw new WhiteboardRecoveryError('IDEMPOTENCY_CONFLICT');
        return project(row);
      }
      // The opaque access receipt was issued by this server after a successful authenticated
      // sync. It survives a later Board-member revocation and is impossible for another actor,
      // tenant or session to substitute by inventing client metadata.
      const proof=await s.query(`SELECT ar.receipt_id FROM whiteboard_quarantine_access_receipts ar
        JOIN org_memberships om ON om.org_id=ar.org_id AND om.user_id=$2
        JOIN organizations o ON o.id=ar.org_id
        WHERE ar.org_id=$1 AND ar.board_id=$3 AND ar.actor_id=$2 AND ar.receipt_id=$4
          AND ar.session_fingerprint=$5 AND ar.epoch=$6 AND ar.active=true
          AND ar.consumed_at IS NULL AND ar.expires_at>now() AND o.status='active'
        FOR UPDATE OF ar`,[p.orgId,p.userId,id,input.accessReceiptId,input.sessionFingerprint,input.epoch]);
      if(!proof.rows.length){
        const concurrent=await lookup();
        if(!concurrent.rows.length)return null;
        const exact=concurrent.rows.find(value=>value.request_id===input.requestId&&value.request_hash===hash);
        if(concurrent.rows.length!==1||!exact)throw new WhiteboardRecoveryError('IDEMPOTENCY_CONFLICT');
        return project(exact);
      }
      await s.query(`INSERT INTO whiteboard_quarantine_recovery_requests
        (org_id,board_id,request_id,receipt_id,access_receipt_id,request_hash,requested_by,session_fingerprint,epoch,pending_count,pending_bytes,reason,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending-review')
        ON CONFLICT DO NOTHING`,[p.orgId,id,input.requestId,input.receiptId,input.accessReceiptId,hash,p.userId,input.sessionFingerprint,input.epoch,input.pendingCount,input.pendingBytes,input.reason]);
      const result=await lookup(),row=result.rows.find(value=>value.request_id===input.requestId&&value.request_hash===hash);
      if(result.rows.length!==1||!row)throw new WhiteboardRecoveryError('IDEMPOTENCY_CONFLICT');
      await s.query(`UPDATE whiteboard_quarantine_access_receipts SET active=false,consumed_at=COALESCE(consumed_at,now()),inactive_at=COALESCE(inactive_at,now())
        WHERE org_id=$1 AND receipt_id=$2 AND actor_id=$3`,[p.orgId,input.accessReceiptId,p.userId]);
      return project(row);
    });
  }
}
