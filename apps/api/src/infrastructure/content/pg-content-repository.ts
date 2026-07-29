/**
 * PostgreSQL implementation of `ContentRepository`.
 *
 * Every query runs through `withTenant`, so RLS is the first line and the `org_id`
 * predicates are the second.
 *
 * Note that no method here returns a row object. `findItemFacts` returns three named
 * fields and `findItemBody` returns a string, because a shared row type is how a body ends
 * up somewhere that only wanted a status -- and the personal-layer boundary is exactly a
 * rule about what must not travel.
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { ContentRepository } from "../../application/identity/content-ports";
import type { ContentItemFacts } from "../../domain/identity/admin-boundary";
import type { OrgId } from "../../domain/org-id";

export class PgContentRepository implements ContentRepository {
  constructor(private readonly db: DatabasePort) {}

  async findItemFacts(orgId: OrgId, itemId: string): Promise<ContentItemFacts | null> {
    return this.db.withTenant(orgId, async (s) => {
      // `body` is deliberately absent from this SELECT. The boundary rule does not need
      // it, and a column that was never read cannot be returned by mistake.
      const r = await s.query<{ layer: string; status: string; owner_user_id: string }>(
        "SELECT layer, status, owner_user_id FROM content_items WHERE id = $1 AND org_id = $2",
        [itemId, orgId],
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        layer: row.layer as ContentItemFacts["layer"],
        status: row.status as ContentItemFacts["status"],
        ownerUserId: row.owner_user_id,
      };
    });
  }

  async findItemBody(orgId: OrgId, itemId: string): Promise<string | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ body: string }>(
        "SELECT body FROM content_items WHERE id = $1 AND org_id = $2",
        [itemId, orgId],
      );
      // `?? null` and not `?? ""`: an empty body is a legal body, and collapsing the two
      // would turn "the row disappeared" into "the row is blank".
      return r.rows[0]?.body ?? null;
    });
  }

  async countPersonalItems(orgId: OrgId, userId: string): Promise<number> {
    return this.db.withTenant(orgId, async (s) => {
      // COUNT in SQL, not `rows.length`. Selecting the rows in order to count them means
      // the bodies are loaded into the process that must not disclose them -- and from
      // there, disclosure is one careless `res.json(rows)` away.
      const r = await s.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM content_items
          WHERE org_id = $1 AND owner_user_id = $2 AND layer = 'personal'`,
        [orgId, userId],
      );
      return Number(r.rows[0]?.n ?? "0");
    });
  }
}
