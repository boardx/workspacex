/**
 * 2026-09-08——收件箱标签侧表 `inbox_item_tags` 的 PostgreSQL 适配器
 * （迁移 `20260910040000_inbox_item_tags.sql`）。结构同 `pg-inbox-order-repository.ts`。
 */
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import { toOrgId } from "../../domain/org-id";
import { boardOrderKey } from "../../domain/inbox/board-order";
import type {
  InboxTagRepository,
  InboxTagRepositoryFactory,
  InboxTaggableKind,
} from "../../application/inbox/inbox-tags.port";

class ScopedPgInboxTagRepository implements InboxTagRepository {
  constructor(
    private readonly db: DatabasePort,
    private readonly orgId: string,
  ) {}

  async getTags(): Promise<ReadonlyMap<string, readonly string[]>> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      const { rows } = await s.query<{ kind: string; item_id: string; tags: string[] }>(
        `SELECT kind, item_id, tags FROM inbox_item_tags WHERE org_id = $1`,
        [this.orgId],
      );
      const out = new Map<string, readonly string[]>();
      for (const row of rows) out.set(boardOrderKey(row.kind as InboxTaggableKind, row.item_id), row.tags);
      return out;
    });
  }

  async setTags(kind: InboxTaggableKind, id: string, tags: readonly string[]): Promise<void> {
    await this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      await s.query(
        `INSERT INTO inbox_item_tags (org_id, kind, item_id, tags, updated_at)
         VALUES ($1, $2, $3, $4::text[], now())
         ON CONFLICT (org_id, kind, item_id)
         DO UPDATE SET tags = EXCLUDED.tags, updated_at = now()`,
        [this.orgId, kind, id, [...tags]],
      );
    });
  }
}

export class PgInboxTagRepository implements InboxTagRepositoryFactory {
  constructor(private readonly db: DatabasePort) {}

  forOrg(orgId: string): InboxTagRepository {
    return new ScopedPgInboxTagRepository(this.db, orgId);
  }
}
