import { createHash, randomUUID } from 'node:crypto';
import { whiteboard as C } from '@repo/contracts';
import type { DatabasePort, TenantSession } from '../../application/ports/database.port';
import type { Principal } from '../../domain/principal';
import {
  WhiteboardResourceError,
  type CreateBoardTag,
  type DeleteBoardTag,
  type RenameBoardTag,
  type WhiteboardTagRepository,
} from '../../application/whiteboard/ports';

type TagRow = { id:string;name:string;revision:number;created_by:string;created_at:Date;updated_at:Date;deleted_at:Date|null;can_manage?:boolean };
type ReceiptRow = { request_hash:string;operation:string;tag_id:string;result_name:string|null;result_revision:number;result_updated_at:Date };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalizeName = (name: string) => name.trim().normalize('NFKC');
const nameKey = (name: string) => normalizeName(name).toLocaleLowerCase('en-US');
const view = (row: TagRow): C.BoardTag => C.BoardTag.parse({ id:row.id,name:row.name,revision:row.revision,createdBy:row.created_by,
  createdAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString() });
const uniqueViolation = (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505');

export class PgWhiteboardTagRepository implements WhiteboardTagRepository {
  constructor(private readonly db: DatabasePort) {}

  async listTags(p: Principal): Promise<C.BoardTag[]> {
    return this.db.withTenant(p.orgId, async session => {
      const member = await session.query(`SELECT 1 FROM org_memberships WHERE org_id=$1 AND user_id=$2`, [p.orgId,p.userId]);
      if (!member.rows.length) return [];
      const result = await session.query<TagRow>(`SELECT id,name,revision,created_by,created_at,updated_at,deleted_at
        FROM whiteboard_tags WHERE org_id=$1 AND deleted_at IS NULL ORDER BY name_key,id`, [p.orgId]);
      return result.rows.map(view);
    });
  }

  async createTag(p: Principal, input: CreateBoardTag): Promise<C.BoardTag> {
    const name = normalizeName(input.name), requestHash = hash({operation:'create-tag',name});
    try {
      return await this.db.withTenant(p.orgId, async session => {
        const member = await session.query(`SELECT 1 FROM org_memberships WHERE org_id=$1 AND user_id=$2 FOR SHARE`, [p.orgId,p.userId]);
        if (!member.rows.length) throw new WhiteboardResourceError('NOT_FOUND');
        await session.query(`INSERT INTO whiteboard_tags(id,org_id,created_by,request_id,request_hash,name,name_key)
          VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(org_id,created_by,request_id) DO NOTHING`,
          [randomUUID(),p.orgId,p.userId,input.requestId,requestHash,name,nameKey(name)]);
        const result = await session.query<TagRow & {request_hash:string}>(`SELECT id,name,revision,created_by,created_at,updated_at,deleted_at,request_hash
          FROM whiteboard_tags WHERE org_id=$1 AND created_by=$2 AND request_id=$3`, [p.orgId,p.userId,input.requestId]);
        const row = result.rows[0];
        if (!row) throw new WhiteboardResourceError('TAG_NAME_CONFLICT');
        if (row.request_hash !== requestHash) throw new WhiteboardResourceError('IDEMPOTENCY_CONFLICT');
        return view(row);
      });
    } catch (error) {
      if (uniqueViolation(error)) throw new WhiteboardResourceError('TAG_NAME_CONFLICT');
      throw error;
    }
  }

  async renameTag(p: Principal, tagId: string, input: RenameBoardTag): Promise<C.BoardTag | null> {
    const name = normalizeName(input.name), requestHash = hash({operation:'rename-tag',tagId,name,expectedRevision:input.expectedRevision});
    try {
      return await this.db.withTenant(p.orgId, async session => {
        const replay = await this.receipt(session,p,input.requestId,requestHash,'rename',tagId);
        if (replay) return this.replayedTag(session,p,tagId,replay);
        const row = await this.lockManageableTag(session,p,tagId); if (!row) return null;
        const afterLock = await this.receipt(session,p,input.requestId,requestHash,'rename',tagId);
        if (afterLock) return this.replayedTag(session,p,tagId,afterLock);
        if (row.revision !== input.expectedRevision) throw new WhiteboardResourceError('REVISION_CONFLICT');
        const updated = await session.query<TagRow>(`UPDATE whiteboard_tags SET name=$3,name_key=$4,revision=revision+1,updated_at=now()
          WHERE org_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING id,name,revision,created_by,created_at,updated_at,deleted_at`,
          [p.orgId,tagId,name,nameKey(name)]);
        const result = updated.rows[0]!;
        await this.saveReceipt(session,p,input.requestId,requestHash,'rename',tagId,result.name,result.revision,result.updated_at);
        return view(result);
      });
    } catch (error) {
      if (uniqueViolation(error)) throw new WhiteboardResourceError('TAG_NAME_CONFLICT');
      throw error;
    }
  }

  async deleteTag(p: Principal, tagId: string, input: DeleteBoardTag): Promise<{requestId:string;tagId:string;deleted:true} | null> {
    const requestHash = hash({operation:'delete-tag',tagId,expectedRevision:input.expectedRevision});
    return this.db.withTenant(p.orgId, async session => {
      const replay = await this.receipt(session,p,input.requestId,requestHash,'delete',tagId);
      if (replay) return {requestId:input.requestId,tagId,deleted:true};
      const row = await this.lockManageableTag(session,p,tagId);
      if (!row) {
        const concurrent = await this.receipt(session,p,input.requestId,requestHash,'delete',tagId);
        return concurrent ? {requestId:input.requestId,tagId,deleted:true} : null;
      }
      const afterLock = await this.receipt(session,p,input.requestId,requestHash,'delete',tagId);
      if (afterLock) return {requestId:input.requestId,tagId,deleted:true};
      if (row.revision !== input.expectedRevision) throw new WhiteboardResourceError('REVISION_CONFLICT');
      const updated = await session.query<{revision:number;updated_at:Date}>(`UPDATE whiteboard_tags SET deleted_at=now(),revision=revision+1,updated_at=now()
        WHERE org_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING revision,updated_at`, [p.orgId,tagId]);
      const result = updated.rows[0]!;
      await session.query(`WITH removed AS (
          DELETE FROM whiteboard_tag_bindings WHERE org_id=$1 AND tag_id=$2 RETURNING board_id
        ), affected AS (SELECT DISTINCT board_id FROM removed)
        UPDATE whiteboards b SET tags_revision=b.tags_revision+1,updated_at=now()
        FROM affected WHERE b.org_id=$1 AND b.id=affected.board_id`, [p.orgId,tagId]);
      await this.saveReceipt(session,p,input.requestId,requestHash,'delete',tagId,null,result.revision,result.updated_at);
      return {requestId:input.requestId,tagId,deleted:true};
    });
  }

  private async lockManageableTag(session: TenantSession, p: Principal, tagId: string): Promise<TagRow | null> {
    const result = await session.query<TagRow>(`SELECT t.id,t.name,t.revision,t.created_by,t.created_at,t.updated_at,t.deleted_at,
      (t.created_by=$2 OR EXISTS(SELECT 1 FROM org_memberships om WHERE om.org_id=$1 AND om.user_id=$2 AND om.org_role='admin')) AS can_manage
      FROM whiteboard_tags t WHERE t.org_id=$1 AND t.id=$3 AND t.deleted_at IS NULL FOR UPDATE`, [p.orgId,p.userId,tagId]);
    const row = result.rows[0];
    return row?.can_manage ? row : null;
  }
  private async receipt(session: TenantSession, p: Principal, requestId: string, requestHash: string, operation: string, tagId: string): Promise<ReceiptRow | null> {
    const result = await session.query<ReceiptRow>(`SELECT request_hash,operation,tag_id,result_name,result_revision,result_updated_at
      FROM whiteboard_tag_mutation_receipts WHERE org_id=$1 AND actor_id=$2 AND request_id=$3`, [p.orgId,p.userId,requestId]);
    const row = result.rows[0];
    if (row && (row.request_hash!==requestHash || row.operation!==operation || row.tag_id!==tagId)) throw new WhiteboardResourceError('IDEMPOTENCY_CONFLICT');
    return row ?? null;
  }
  private async replayedTag(session: TenantSession, p: Principal, tagId: string, receipt: ReceiptRow): Promise<C.BoardTag> {
    const original = await session.query<TagRow>(`SELECT id,created_by,created_at,deleted_at,name,revision,updated_at FROM whiteboard_tags WHERE org_id=$1 AND id=$2`, [p.orgId,tagId]);
    const row = original.rows[0]; if (!row || !receipt.result_name) throw new WhiteboardResourceError('NOT_FOUND');
    return view({...row,name:receipt.result_name,revision:receipt.result_revision,updated_at:receipt.result_updated_at});
  }
  private async saveReceipt(session: TenantSession, p: Principal, requestId:string, requestHash:string, operation:string, tagId:string, name:string|null, revision:number, updatedAt:Date): Promise<void> {
    await session.query(`INSERT INTO whiteboard_tag_mutation_receipts(org_id,actor_id,request_id,request_hash,operation,tag_id,result_name,result_revision,result_updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [p.orgId,p.userId,requestId,requestHash,operation,tagId,name,revision,updatedAt]);
  }
}
