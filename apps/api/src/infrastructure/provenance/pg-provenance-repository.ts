/**
 * PostgreSQL implementation of the provenance writer and reader.
 *
 * ## Append-only is enforced below this class, not by it
 *
 * There is no `update` or `delete` method here -- but that alone would only mean "this
 * class does not offer one". The actual guarantee is a GRANT: migration 0005 gives the
 * runtime role SELECT and INSERT on `provenance_events` and nothing else, so a mutation
 * fails at the database whoever writes it and however they get there. This file is the
 * convenient path; the grant is the guarantee.
 */
import { provenance as P } from "@repo/contracts";
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  ProvenanceAppendInput,
  ProvenanceEventRecord,
  ProvenancePage,
  ProvenanceQuery,
  ProvenanceReader,
  ProvenanceWriter,
} from "../../application/provenance/ports";
import type { OrgId } from "../../domain/org-id";

interface EventRow {
  id: string;
  type: string;
  actor_id: string;
  at: Date;
  org_id: string;
  target_kind: string;
  target_id: string;
  detail: Record<string, unknown>;
}

const toRecord = (r: EventRow): ProvenanceEventRecord => ({
  id: r.id,
  type: r.type as ProvenanceEventRecord["type"],
  actorId: r.actor_id,
  // ISO 8601, as the contract says. `Date` would serialise to the same string today and
  // stop doing so the moment anything wraps this in a different serialiser.
  at: r.at.toISOString(),
  orgId: r.org_id,
  target: { kind: r.target_kind as ProvenanceEventRecord["target"]["kind"], id: r.target_id },
  detail: r.detail,
});

/** Keyset cursor: the (at, id) of the last row returned. Opaque to callers. */
const encodeCursor = (r: EventRow): string =>
  Buffer.from(`${r.at.toISOString()}|${r.id}`, "utf8").toString("base64url");

function decodeCursor(c: string): { at: string; id: string } | null {
  const [at, id] = Buffer.from(c, "base64url").toString("utf8").split("|");
  // A malformed cursor returns null and is ignored rather than throwing. It is a client
  // artefact, not a permission decision, and a 500 on a stale bookmark helps nobody.
  return at && id ? { at, id } : null;
}

const DEFAULT_LIMIT = 100;

export class PgProvenanceRepository implements ProvenanceWriter, ProvenanceReader {
  constructor(private readonly db: DatabasePort) {}

  async append(input: ProvenanceAppendInput): Promise<string> {
    // Parsed against the shared contract before it reaches SQL. The database CHECK says
    // the same thing, and that duplication is deliberate and reconciled by a test: this
    // gives a readable error at the boundary, the CHECK covers every other writer.
    const type = P.ProvenanceEventType.parse(input.type);
    return this.db.withTenant(input.orgId, async (s) => {
      const r = await s.query<{ id: string }>(
        `INSERT INTO provenance_events (org_id, type, actor_id, target_kind, target_id, detail)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING id`,
        [input.orgId, type, input.actorId, input.target.kind, input.target.id,
         JSON.stringify(input.detail)],
      );
      const id = r.rows[0]?.id;
      // An INSERT ... RETURNING with no row back means the write did not happen. Silently
      // returning an empty id would hand the caller a "trail id" pointing at nothing.
      if (!id) throw new Error("provenance append returned no id");
      return id;
    });
  }

  async query(orgId: OrgId, q: Omit<ProvenanceQuery, "orgId">): Promise<ProvenancePage> {
    return this.db.withTenant(orgId, async (s) => {
      const where: string[] = ["org_id = $1"];
      const params: unknown[] = [orgId];
      const add = (sql: string, value: unknown): void => {
        params.push(value);
        where.push(sql.replace("?", `$${params.length}`));
      };

      if (q.types && q.types.length > 0) add("type = ANY(?::text[])", q.types);
      if (q.actorId !== undefined) add("actor_id = ?", q.actorId);
      if (q.targetKind !== undefined) add("target_kind = ?", q.targetKind);
      if (q.targetId !== undefined) add("target_id = ?", q.targetId);
      if (q.since !== undefined) add("at >= ?::timestamptz", q.since);
      if (q.until !== undefined) add("at <= ?::timestamptz", q.until);

      const cursor = q.cursor ? decodeCursor(q.cursor) : null;
      if (cursor) {
        // Row-value comparison, not `at < x OR (at = x AND id < y)` spelled out: events
        // written in the same transaction share a timestamp, and the naive form either
        // repeats or skips them.
        params.push(cursor.at, cursor.id);
        where.push(`(at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
      }

      const limit = q.limit ?? DEFAULT_LIMIT;
      // One extra row, to learn whether there is a next page without a second count query.
      params.push(limit + 1);

      const r = await s.query<EventRow>(
        `SELECT id, type, actor_id, at, org_id, target_kind, target_id, detail
           FROM provenance_events
          WHERE ${where.join(" AND ")}
          ORDER BY at DESC, id DESC
          LIMIT $${params.length}`,
        params,
      );

      const hasMore = r.rows.length > limit;
      const rows = hasMore ? r.rows.slice(0, limit) : r.rows;
      return {
        events: rows.map(toRecord),
        nextCursor: hasMore && rows.length > 0 ? encodeCursor(rows[rows.length - 1]!) : null,
      };
    });
  }
}
