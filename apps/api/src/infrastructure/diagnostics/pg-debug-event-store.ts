/**
 * `PgDebugEventStore` —— `debug_events` 的写入 / 裁剪 / 读回（issue #3082）。
 *
 * 写走 `app_rw`（多行 INSERT，一批一条语句）；读走 `app_diag_ro` 的两个 SECURITY DEFINER
 * 函数，与 `PgErrorLogWriter.list()` 同一条边界（迁移 `20260910040000_debug_events.sql`）。
 *
 * ## 保留策略：按天 + 按条数，两道都裁
 *
 * 按天（`RETENTION_DAYS`）防止表无限长；按条数（`MAX_ROWS`）防止一次异常风暴在几分钟内
 * 把磁盘写满——两者取更严。裁剪在每 `HOUSEKEEPING_EVERY` 次 flush 后顺手做一次，加上进程
 * 启动一次（`main.ts`）。app_rw 只有 `(id, created_at)` 的 SELECT，正好够这两条 WHERE。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  DebugEvent,
  DebugEventLevel,
  DebugEventPage,
  DebugEventQuery,
  DebugEventRow,
  DebugEventStore,
} from "../../application/ports/debug-trace.port";

export const RETENTION_DAYS = 7;
export const MAX_ROWS = 500_000;
const HOUSEKEEPING_EVERY = 20;

interface Row {
  id: string; trace_id: string; kind: string; level: DebugEventLevel; msg: string; data: unknown;
  duration_ms: number | null; user_ref: string | null; org_ref: string | null; created_at: Date;
}

function toRow(r: Row): DebugEventRow {
  return {
    id: String(r.id),
    traceId: r.trace_id,
    kind: r.kind,
    level: r.level,
    msg: r.msg,
    data: r.data ?? null,
    durationMs: r.duration_ms,
    userId: r.user_ref,
    orgId: r.org_ref,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export async function sweepDebugEvents(
  db: DatabasePort,
  opts: { retentionDays?: number; maxRows?: number } = {},
): Promise<{ readonly ok: boolean; readonly error?: unknown }> {
  const days = opts.retentionDays ?? RETENTION_DAYS;
  const maxRows = opts.maxRows ?? MAX_ROWS;
  try {
    await db.withoutTenant(async (s) => {
      await s.query(`DELETE FROM debug_events WHERE created_at < now() - ($1::int * interval '1 day')`, [days]);
      await s.query(
        `DELETE FROM debug_events
          WHERE id <= COALESCE((SELECT id FROM debug_events ORDER BY id DESC OFFSET $1 LIMIT 1), 0)`,
        [maxRows],
      );
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

export class PgDebugEventStore implements DebugEventStore {
  private flushCount = 0;

  constructor(
    private readonly db: DatabasePort,
    private readonly readDb: DatabasePort,
    private readonly opts: { retentionDays?: number; maxRows?: number; housekeepingEvery?: number } = {},
  ) {}

  async insertBatch(events: readonly DebugEvent[]): Promise<void> {
    if (events.length === 0) return;
    const cols = 9;
    const values: unknown[] = [];
    const tuples = events.map((e, i) => {
      const b = i * cols;
      values.push(e.traceId, e.kind, e.level, e.msg, e.data === null ? null : JSON.stringify(e.data),
        e.durationMs, e.userId, e.orgId, e.createdAt);
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}::jsonb, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}::timestamptz)`;
    });
    await this.db.withoutTenant((s) =>
      s.query(
        `INSERT INTO debug_events (trace_id, kind, level, msg, data, duration_ms, user_ref, org_ref, created_at)
         VALUES ${tuples.join(", ")}`,
        values,
      ),
    );
    this.flushCount += 1;
    if (this.flushCount % (this.opts.housekeepingEvery ?? HOUSEKEEPING_EVERY) === 0) {
      // 裁剪失败不算写失败——事件已经落库了；下一轮再试。
      await sweepDebugEvents(this.db, this.opts);
    }
  }

  async query(q: DebugEventQuery): Promise<DebugEventPage> {
    const fetchLimit = q.limit + 1;
    const { rows } = await this.readDb.withoutTenant((s) =>
      s.query<Row>(
        `SELECT * FROM kernel_read_debug_events($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [fetchLimit, q.beforeId, q.traceId ?? null, q.kind ?? null, q.level ?? null,
          q.since ?? null, q.until ?? null, q.q ?? null, q.userId ?? null],
      ),
    );
    const hasMore = rows.length > q.limit;
    return { items: (hasMore ? rows.slice(0, q.limit) : rows).map(toRow), hasMore };
  }

  async getTrace(traceId: string): Promise<readonly DebugEventRow[]> {
    const { rows } = await this.readDb.withoutTenant((s) =>
      s.query<Row>(`SELECT * FROM kernel_read_debug_trace($1)`, [traceId]),
    );
    return rows.map(toRow);
  }
}
