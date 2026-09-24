import { createHash } from 'node:crypto';
import { whiteboardWorkshopControl as W } from '@repo/contracts';
import type { DatabasePort, TenantSession } from '../../application/ports/database.port';
import { WorkshopControlError as Fault, type WorkshopControlRepository } from '../../application/whiteboard/workshop-control-ports';
import type { Principal } from '../../domain/principal';

type StateRow = { frozen: boolean; hidden_phase_ids: string[]; revision: string; updated_by: string | null; updated_at: Date | null };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function state(row: StateRow): W.WorkshopControlState {
  return W.WorkshopControlState.parse({ frozen: row.frozen, hiddenPhaseIds: row.hidden_phase_ids, revision: Number(row.revision), updatedBy: row.updated_by, updatedAt: row.updated_at?.toISOString() ?? null });
}

export class PgWorkshopControlRepository implements WorkshopControlRepository {
  constructor(private readonly db: DatabasePort) {}

  private async authorize(session: TenantSession, p: Principal, boardId: string, control: boolean): Promise<void> {
    const result = await session.query<{ owner_id: string; role: string | null }>(
      `SELECT b.owner_id,m.role FROM whiteboards b LEFT JOIN whiteboard_members m ON m.org_id=b.org_id AND m.board_id=b.id AND m.user_id=$3 WHERE b.org_id=$1 AND b.id=$2 FOR UPDATE OF b`,
      [p.orgId, boardId, p.userId],
    );
    const board = result.rows[0];
    if (!board || (board.owner_id !== p.userId && board.role === null)) throw new Fault('NOT_FOUND');
    if (!control || board.owner_id === p.userId) return;
    // Serialize the admin exception with role changes. Both paths lock this target
    // membership row; this transaction already owns the Board lock and role changes
    // never acquire Board locks, so the order cannot form a lock cycle.
    const membership = await session.query<{ org_role: string }>(`SELECT org_role FROM org_memberships WHERE org_id=$1 AND user_id=$2 FOR UPDATE`, [p.orgId, p.userId]);
    if (membership.rows[0]?.org_role !== 'admin') throw new Fault('FORBIDDEN');
  }

  private async ensureState(session: TenantSession, p: Principal, boardId: string): Promise<StateRow> {
    await session.query(`INSERT INTO whiteboard_workshop_controls(org_id,board_id) VALUES($1,$2) ON CONFLICT(org_id,board_id) DO NOTHING`, [p.orgId, boardId]);
    const result = await session.query<StateRow>(`SELECT frozen,hidden_phase_ids,revision,updated_by,updated_at FROM whiteboard_workshop_controls WHERE org_id=$1 AND board_id=$2 FOR UPDATE`, [p.orgId, boardId]);
    const row = result.rows[0]; if (!row) throw new Fault('NOT_FOUND'); return row;
  }

  async get(p: Principal, boardId: string): Promise<W.WorkshopControlState> {
    return this.db.withTenant(p.orgId, async session => { await this.authorize(session, p, boardId, false); return state(await this.ensureState(session, p, boardId)); });
  }
  async setFreeze(p: Principal, boardId: string, input: W.SetWorkshopFreeze) {
    return this.mutate(p, boardId, input.requestId, { action: 'freeze', frozen: input.frozen },
      (session) => session.query<StateRow>(`UPDATE whiteboard_workshop_controls SET frozen=$3,revision=revision+1,updated_by=$4,updated_at=now() WHERE org_id=$1 AND board_id=$2 RETURNING frozen,hidden_phase_ids,revision,updated_by,updated_at`, [p.orgId, boardId, input.frozen, p.userId]));
  }
  async hidePhases(p: Principal, boardId: string, input: W.HideWorkshopPhases) {
    const phaseIds = [...input.phaseIds].sort();
    return this.mutate(p, boardId, input.requestId, { action: 'hide', phaseIds },
      (session) => session.query<StateRow>(`UPDATE whiteboard_workshop_controls SET hidden_phase_ids=ARRAY(SELECT DISTINCT value FROM unnest(hidden_phase_ids || $3::text[]) value ORDER BY value),revision=revision+1,updated_by=$4,updated_at=now() WHERE org_id=$1 AND board_id=$2 RETURNING frozen,hidden_phase_ids,revision,updated_by,updated_at`, [p.orgId, boardId, phaseIds, p.userId]));
  }
  async revealPhases(p: Principal, boardId: string, input: W.RevealWorkshopPhases) {
    return this.mutate(p, boardId, input.requestId, { action: 'reveal' },
      (session) => session.query<StateRow>(`UPDATE whiteboard_workshop_controls SET hidden_phase_ids='{}'::text[],revision=revision+1,updated_by=$3,updated_at=now() WHERE org_id=$1 AND board_id=$2 RETURNING frozen,hidden_phase_ids,revision,updated_by,updated_at`, [p.orgId, boardId, p.userId]));
  }

  private async mutate(p: Principal, boardId: string, requestId: string, payload: unknown, apply: (session: TenantSession) => Promise<{ rows: StateRow[] }>): Promise<W.WorkshopControlState> {
    return this.db.withTenant(p.orgId, async session => {
      await this.authorize(session, p, boardId, true); await this.ensureState(session, p, boardId);
      const requestHash = hash(payload);
      const prior = await session.query<{ request_hash: string; response_state: unknown }>(`SELECT request_hash,response_state FROM whiteboard_workshop_control_requests WHERE org_id=$1 AND board_id=$2 AND actor_id=$3 AND request_id=$4`, [p.orgId, boardId, p.userId, requestId]);
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash !== requestHash) throw new Fault('IDEMPOTENCY_CONFLICT');
        return W.WorkshopControlState.parse(prior.rows[0].response_state);
      }
      const changed = (await apply(session)).rows[0]; if (!changed) throw new Fault('NOT_FOUND');
      const response = state(changed);
      await session.query(`INSERT INTO whiteboard_workshop_control_requests(org_id,board_id,actor_id,request_id,request_hash,response_state) VALUES($1,$2,$3,$4,$5,$6::jsonb)`, [p.orgId, boardId, p.userId, requestId, requestHash, JSON.stringify(response)]);
      return response;
    });
  }
}
