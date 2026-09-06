/**
 * UC-17.8——收件箱看板「列内排序」的 PostgreSQL 适配器。
 *
 * 落到 `inbox_item_order`（迁移 `20260906120000_inbox_board_order.sql`）——独立表，
 * 不碰 `product_feedback` / `error_logs` / `design_projects` 任何一张源表，
 * 见该迁移文件头注。
 */
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import { toOrgId } from "../../domain/org-id";
import { boardOrderKey } from "../../domain/inbox/board-order";
import type {
  InboxOrderEntry,
  InboxOrderRepository,
  InboxOrderRepositoryFactory,
} from "../../application/inbox/inbox-order.port";

class ScopedPgInboxOrderRepository implements InboxOrderRepository {
  constructor(
    private readonly db: DatabasePort,
    private readonly orgId: string,
  ) {}

  async getOrders(): Promise<ReadonlyMap<string, number>> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      const { rows } = await s.query<{ kind: string; item_id: string; sort_order: string | number }>(
        `SELECT kind, item_id, sort_order FROM inbox_item_order WHERE org_id = $1`,
        [this.orgId],
      );
      const out = new Map<string, number>();
      for (const row of rows) {
        out.set(boardOrderKey(row.kind as "feedback" | "exception" | "design", row.item_id), Number(row.sort_order));
      }
      return out;
    });
  }

  /**
   * ⚠ `unnest` 一次性 upsert 整批——不是循环发 N 条 `INSERT ... ON CONFLICT`。
   *   一列几十张卡片一次拖拽排序就是几十条独立语句，量级上没必要,且 `withTenant`
   *   包的是同一个事务,循环发语句不会更安全,只会更慢。
   */
  async setOrders(entries: readonly InboxOrderEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      await s.query(
        `INSERT INTO inbox_item_order (org_id, kind, item_id, sort_order, updated_at)
         SELECT $1, t.kind, t.item_id, t.sort_order, now()
           FROM unnest($2::text[], $3::text[], $4::float8[]) AS t(kind, item_id, sort_order)
         ON CONFLICT (org_id, kind, item_id)
         DO UPDATE SET sort_order = EXCLUDED.sort_order, updated_at = now()`,
        [
          this.orgId,
          entries.map((e) => e.kind),
          entries.map((e) => e.id),
          entries.map((e) => e.order),
        ],
      );
    });
  }
}

export class PgInboxOrderRepository implements InboxOrderRepositoryFactory {
  constructor(private readonly db: DatabasePort) {}

  forOrg(orgId: string): InboxOrderRepository {
    return new ScopedPgInboxOrderRepository(this.db, orgId);
  }
}
