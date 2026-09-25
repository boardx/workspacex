import { randomUUID } from 'node:crypto';
import { whiteboard as C } from '@repo/contracts';
import type { Principal } from '../../domain/principal';
import type { DatabasePort } from '../../application/ports/database.port';
import type { WhiteboardRepository, CreateBoard, UpdateBoard, Member } from '../../application/whiteboard/ports';

type Row = { id: string; name: string; owner_id: string; role: string; archived: boolean; created_at: Date; updated_at: Date };
const columns = `b.id, b.name, b.owner_id, b.archived, b.created_at, b.updated_at,
 CASE WHEN b.owner_id = $2 THEN 'owner' ELSE m.role END AS role`;
const membership = `LEFT JOIN whiteboard_members m ON m.org_id=b.org_id AND m.board_id=b.id AND m.user_id=$2`;
const visible = `(b.owner_id=$2 OR m.user_id IS NOT NULL)`;
function view(r: Row): C.Board {
  return C.Board.parse({ id: r.id, name: r.name, ownerId: r.owner_id, role: r.role, archived: r.archived,
    createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString() });
}
/** All SQL is tenant-scoped and actor-filtered. A resource ID never grants access. */
export class PgWhiteboardRepository implements WhiteboardRepository {
  constructor(private readonly db: DatabasePort) {}
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
}
