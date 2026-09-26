import { createHash, randomUUID } from 'node:crypto';
import { whiteboard as C } from '@repo/contracts';
import type { Principal } from '../../domain/principal';
import type { DatabasePort } from '../../application/ports/database.port';
import {
  WhiteboardResourceError,
  type BoardListPage,
  type CreateBoard,
  type DeleteBoard,
  type ListBoards,
  type Member,
  type UpdateBoard,
  type WhiteboardRepository,
} from '../../application/whiteboard/ports';
import { WhiteboardCursorCodec } from './whiteboard-cursor';

type Row = { id: string; name: string; owner_id: string; role: string; archived: boolean; tags_revision: number; tag_ids: string[]; created_at: Date; updated_at: Date };
const tagIds = `COALESCE(ARRAY(SELECT bt.tag_id FROM whiteboard_tag_bindings bt
  JOIN whiteboard_tags t ON t.org_id=bt.org_id AND t.id=bt.tag_id AND t.deleted_at IS NULL
  WHERE bt.org_id=b.org_id AND bt.board_id=b.id ORDER BY bt.tag_id), ARRAY[]::uuid[]) AS tag_ids`;
const columns = `b.id,b.name,b.owner_id,b.archived,b.tags_revision,b.created_at,b.updated_at,${tagIds},
  CASE WHEN b.owner_id=$2 THEN 'owner' ELSE m.role END AS role`;
const membership = `LEFT JOIN whiteboard_members m ON m.org_id=b.org_id AND m.board_id=b.id AND m.user_id=$2`;
const visible = `(b.owner_id=$2 OR m.user_id IS NOT NULL)`;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const escapeLike = (value: string) => value.replace(/[\\%_]/g, match => `\\${match}`);
function view(row: Row): C.Board {
  return C.Board.parse({ id: row.id, name: row.name, ownerId: row.owner_id, role: row.role, archived: row.archived,
    tagIds: row.tag_ids, tagsRevision: row.tags_revision, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() });
}

/** Tenant RLS and explicit actor predicates both apply; resource IDs never grant access. */
export class PgWhiteboardRepository implements WhiteboardRepository {
  constructor(private readonly db: DatabasePort, private readonly cursors = new WhiteboardCursorCodec()) {}

  async list(p: Principal, raw?: ListBoards): Promise<BoardListPage> {
    const input = C.ListBoards.parse(raw ?? {}), cursor = this.cursors.decode(p, input);
    return this.db.withTenant(p.orgId, async session => {
      const requested = input.tagIds ?? [];
      if (requested.length) {
        const tags = await session.query<{id: string}>(`SELECT id FROM whiteboard_tags
          WHERE org_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL ORDER BY id FOR SHARE`, [p.orgId,requested]);
        if (tags.rows.length !== requested.length) throw new WhiteboardResourceError('TAG_NOT_FOUND');
      }
      const result = await session.query<Row>(`SELECT ${columns} FROM whiteboards b ${membership}
        WHERE b.org_id=$1 AND ${visible}
          AND ($3::text IS NULL OR b.name ILIKE $3 ESCAPE '\\')
          AND ($4::uuid[] IS NULL OR b.id IN (
            SELECT board_id FROM whiteboard_tag_bindings WHERE org_id=$1 AND tag_id=ANY($4::uuid[])
            GROUP BY board_id HAVING count(*) = $5))
          AND ($6::text='all' OR b.archived=($6::text='archived'))
          AND ($7::timestamptz IS NULL OR (b.updated_at,b.id)<($7::timestamptz,$8::uuid))
        ORDER BY b.updated_at DESC,b.id DESC LIMIT $9`, [p.orgId,p.userId,input.query ? `%${escapeLike(input.query)}%` : null,
        requested.length ? requested : null,requested.length,input.archived,cursor?.updatedAt ?? null,cursor?.id ?? null,input.limit+1]);
      const hasMore = result.rows.length > input.limit, rows = result.rows.slice(0,input.limit), items = rows.map(view);
      const last = rows.at(-1);
      return { items, nextCursor: hasMore && last ? this.cursors.encode(p,input,{updatedAt:new Date(last.updated_at).toISOString(),id:last.id}) : null };
    });
  }

  async create(p: Principal, input: CreateBoard): Promise<C.Board> {
    return this.db.withTenant(p.orgId, async session => {
      await session.query(`INSERT INTO whiteboards(id,org_id,owner_id,request_id,name) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(org_id,owner_id,request_id) DO NOTHING`, [randomUUID(),p.orgId,p.userId,input.requestId,input.name]);
      const result = await session.query<Row>(`SELECT ${columns} FROM whiteboards b ${membership}
        WHERE b.org_id=$1 AND b.owner_id=$2 AND b.request_id=$3`, [p.orgId,p.userId,input.requestId]);
      return view(result.rows[0]!);
    });
  }

  async get(p: Principal, id: string): Promise<C.Board | null> {
    return this.db.withTenant(p.orgId, async session => {
      const result = await session.query<Row>(`SELECT ${columns} FROM whiteboards b ${membership}
        WHERE b.org_id=$1 AND b.id=$3 AND ${visible}`, [p.orgId,p.userId,id]);
      return result.rows[0] ? view(result.rows[0]) : null;
    });
  }

  async update(p: Principal, id: string, input: UpdateBoard): Promise<C.Board | null> {
    return this.db.withTenant(p.orgId, async session => {
      const requested = input.tagIds;
      if (requested) {
        const locked = await session.query<{id:string}>(`SELECT id FROM whiteboard_tags WHERE org_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL ORDER BY id FOR SHARE`, [p.orgId,requested]);
        if (locked.rows.length !== requested.length) throw new WhiteboardResourceError('TAG_NOT_FOUND');
      }
      const board = await session.query<{tags_revision:number}>(`SELECT tags_revision FROM whiteboards WHERE org_id=$1 AND owner_id=$2 AND id=$3 FOR UPDATE`, [p.orgId,p.userId,id]);
      if (!board.rows[0]) return null;
      if (input.expectedTagsRevision !== undefined && board.rows[0].tags_revision !== input.expectedTagsRevision) throw new WhiteboardResourceError('REVISION_CONFLICT');
      await session.query(`UPDATE whiteboards SET name=COALESCE($4,name),archived=COALESCE($5,archived),
        tags_revision=tags_revision+CASE WHEN $6::boolean THEN 1 ELSE 0 END,updated_at=now()
        WHERE org_id=$1 AND owner_id=$2 AND id=$3`, [p.orgId,p.userId,id,input.name ?? null,input.archived ?? null,requested !== undefined]);
      if (requested) {
        await session.query(`DELETE FROM whiteboard_tag_bindings WHERE org_id=$1 AND board_id=$2`, [p.orgId,id]);
        if (requested.length) await session.query(`INSERT INTO whiteboard_tag_bindings(org_id,board_id,tag_id)
          SELECT $1,$2,id FROM whiteboard_tags WHERE org_id=$1 AND id=ANY($3::uuid[]) AND deleted_at IS NULL`, [p.orgId,id,requested]);
      }
      const updated = await session.query<Row>(`SELECT ${columns} FROM whiteboards b ${membership}
        WHERE b.org_id=$1 AND b.owner_id=$2 AND b.id=$3`, [p.orgId,p.userId,id]);
      return updated.rows[0] ? view(updated.rows[0]) : null;
    });
  }

  async permanentlyDelete(p: Principal, id: string, input: DeleteBoard): Promise<C.DeleteBoardReceipt | null> {
    const requestHash = hash({ operation:'delete-board',boardId:id,confirmation:input.confirmation });
    return this.db.withTenant(p.orgId, async session => {
      const prior = await session.query<{request_hash:string;board_id:string}>(`SELECT request_hash,board_id FROM whiteboard_delete_receipts
        WHERE org_id=$1 AND actor_id=$2 AND request_id=$3`, [p.orgId,p.userId,input.requestId]);
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash !== requestHash || prior.rows[0].board_id !== id) throw new WhiteboardResourceError('IDEMPOTENCY_CONFLICT');
        return C.DeleteBoardReceipt.parse({ requestId:input.requestId,boardId:id,deleted:true });
      }
      const board = await session.query<{archived:boolean}>(`SELECT archived FROM whiteboards WHERE org_id=$1 AND owner_id=$2 AND id=$3 FOR UPDATE`, [p.orgId,p.userId,id]);
      if (!board.rows[0]) {
        // A concurrent replay can observe the board only after the first transaction
        // deleted it. Re-read the durable receipt before reporting a missing board.
        const concurrent = await session.query<{request_hash:string;board_id:string}>(`SELECT request_hash,board_id FROM whiteboard_delete_receipts
          WHERE org_id=$1 AND actor_id=$2 AND request_id=$3`, [p.orgId,p.userId,input.requestId]);
        if (!concurrent.rows[0]) return null;
        if (concurrent.rows[0].request_hash !== requestHash || concurrent.rows[0].board_id !== id) throw new WhiteboardResourceError('IDEMPOTENCY_CONFLICT');
        return C.DeleteBoardReceipt.parse({ requestId:input.requestId,boardId:id,deleted:true });
      }
      if (!board.rows[0].archived) throw new WhiteboardResourceError('BOARD_NOT_ARCHIVED');
      await session.query(`INSERT INTO whiteboard_delete_receipts(org_id,actor_id,request_id,request_hash,board_id) VALUES($1,$2,$3,$4,$5)`, [p.orgId,p.userId,input.requestId,requestHash,id]);
      await session.query(`DELETE FROM whiteboards WHERE org_id=$1 AND owner_id=$2 AND id=$3`, [p.orgId,p.userId,id]);
      return C.DeleteBoardReceipt.parse({ requestId:input.requestId,boardId:id,deleted:true });
    });
  }

  async members(p: Principal, id: string): Promise<Member[] | null> {
    return this.db.withTenant(p.orgId, async session => {
      const board = await session.query(`SELECT id FROM whiteboards WHERE org_id=$1 AND owner_id=$2 AND id=$3 FOR SHARE`, [p.orgId,p.userId,id]);
      if (!board.rows.length) return null;
      const result = await session.query<{user_id:string;role:string}>(`SELECT user_id,role FROM whiteboard_members WHERE org_id=$1 AND board_id=$2 ORDER BY user_id`, [p.orgId,id]);
      return result.rows.map(row => C.Member.parse({userId:row.user_id,role:row.role}));
    });
  }
  async putMember(p: Principal, id: string, member: Member): Promise<boolean> {
    return this.db.withTenant(p.orgId, async session => {
      const owner = await session.query(`SELECT id FROM whiteboards WHERE org_id=$1 AND owner_id=$2 AND id=$3 FOR UPDATE`, [p.orgId,p.userId,id]);
      if (!owner.rows.length) return false;
      const result = await session.query(`INSERT INTO whiteboard_members(org_id,board_id,user_id,role)
        SELECT b.org_id,b.id,$4,$5 FROM whiteboards b JOIN org_memberships om ON om.org_id=b.org_id AND om.user_id=$4
        WHERE b.org_id=$1 AND b.owner_id=$2 AND b.id=$3 AND b.owner_id<>$4
        ON CONFLICT(org_id,board_id,user_id) DO UPDATE SET role=EXCLUDED.role RETURNING user_id`, [p.orgId,p.userId,id,member.userId,member.role]);
      return result.rows.length > 0;
    });
  }
  async removeMember(p: Principal, id: string, userId: string): Promise<boolean> {
    return this.db.withTenant(p.orgId, async session => {
      const owner = await session.query(`SELECT id FROM whiteboards WHERE org_id=$1 AND owner_id=$2 AND id=$3 FOR UPDATE`, [p.orgId,p.userId,id]);
      if (!owner.rows.length || userId===p.userId) return false;
      await session.query(`DELETE FROM whiteboard_members WHERE org_id=$1 AND board_id=$2 AND user_id=$3`, [p.orgId,id,userId]);
      return true;
    });
  }
}
