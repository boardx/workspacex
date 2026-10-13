import { chatShare as C } from "@repo/contracts";
import type { DatabasePort } from "../../application/ports/database.port";
import type { ChatShareRepository, StoredShare } from "../../application/chat/share-ports";
import { guard } from "../../application/security/permission-filter";
import { toOrgId, type OrgId } from "../../domain/org-id";

export class PgChatShareRepository implements ChatShareRepository {
  constructor(private readonly db: DatabasePort) {}
  async insert(orgId: OrgId, input: Parameters<ChatShareRepository["insert"]>[1]) {
    return this.db.withTenant(orgId, async s => {
      // Both rows commit together; a failed export cannot leave a working token.
      const r = await s.query<{ created_at: Date }>(
        `INSERT INTO chat_public_shares (id,org_id,thread_id,created_by,token_hash,snapshot)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING created_at`,
        [input.id, orgId, input.threadId, input.createdBy, input.tokenHash, JSON.stringify(input.snapshot)]);
      await s.query("INSERT INTO chat_public_share_tokens (token_hash,share_id,org_id_hint) VALUES ($1,$2,$3)",
        [input.tokenHash, input.id, orgId]);
      return { id: input.id, createdAt: r.rows[0]!.created_at.toISOString(), revokedAt: null };
    });
  }
  async list(orgId: OrgId, threadId: string, createdBy: string) {
    return this.db.withTenant(orgId, async s => {
      const r = await s.query<{ id: string; created_at: Date; revoked_at: Date | null }>(
        "SELECT id,created_at,revoked_at FROM chat_public_shares WHERE org_id=$1 AND thread_id=$2 AND created_by=$3 ORDER BY created_at DESC",
        [orgId, threadId, createdBy]);
      return r.rows.map(row => ({ id: row.id, createdAt: row.created_at.toISOString(), revokedAt: row.revoked_at?.toISOString() ?? null }));
    });
  }
  async revoke(orgId: OrgId, threadId: string, createdBy: string, shareId: string) {
    return this.db.withTenant(orgId, async s => {
      const r = await s.query(
        `UPDATE chat_public_shares SET revoked_at=COALESCE(revoked_at,now())
         WHERE org_id=$1 AND thread_id=$2 AND created_by=$3 AND id=$4 RETURNING id`,
        [orgId, threadId, createdBy, shareId]);
      return r.rows.length === 1;
    });
  }
  async findByTokenHash(tokenHash: string): Promise<StoredShare | null> {
    // No tenant content is read before the hash identifies the routing hint.
    const hint = await this.db.withoutTenant(async s => {
      const r = await s.query<{ share_id: string; org_id_hint: string }>(
        "SELECT share_id,org_id_hint FROM chat_public_share_tokens WHERE token_hash=$1", [tokenHash]);
      return r.rows[0];
    });
    if (!hint) return null;
    const orgId = toOrgId(hint.org_id_hint);
    return this.db.withTenant(orgId, async s => {
      const r = await s.query<{
        id: string; thread_id: string; created_by: string; token_hash: string;
        snapshot: unknown; created_at: Date; revoked_at: Date | null;
      }>(`SELECT id,thread_id,created_by,token_hash,snapshot,created_at,revoked_at
           FROM chat_public_shares WHERE org_id=$1 AND id=$2 AND token_hash=$3
           AND revoked_at IS NULL
           AND EXISTS (SELECT 1 FROM organizations WHERE id=$1 AND status='active' AND kind='organization')`,
        [orgId, hint.share_id, tokenHash]);
      const row = r.rows[0];
      if (!row) return null;
      return {
        id: row.id, threadId: row.thread_id, createdBy: row.created_by, tokenHash: row.token_hash,
        createdAt: row.created_at.toISOString(), revokedAt: row.revoked_at?.toISOString() ?? null,
        snapshot: guard({ kind: "project", id: row.id }, C.Snapshot.parse(row.snapshot)),
      };
    });
  }
}
