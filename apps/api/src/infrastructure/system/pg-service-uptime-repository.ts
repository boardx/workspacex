/**
 * `ServiceUptimeRepository` on PostgreSQL —— issue #2645。
 *
 * `service_uptime_checks` 与 `error_logs` 同一类（运维自查数据,无 `org_id`,不受
 * RLS 约束）,全部走 `withoutTenant`,见迁移 `..._service_uptime_checks.sql` 头注。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { ServiceUptimeCheckRecord, ServiceUptimeRepository } from "../../application/system/uptime-ports";

interface Row {
  readonly service: string;
  readonly checked_at: Date;
  readonly is_up: boolean;
  readonly latency_ms: number | null;
  readonly error: string | null;
}

export class PgServiceUptimeRepository implements ServiceUptimeRepository {
  constructor(private readonly db: DatabasePort) {}

  async record(entry: ServiceUptimeCheckRecord): Promise<void> {
    await this.db.withoutTenant(async (s) => {
      await s.query(
        `INSERT INTO service_uptime_checks (service, checked_at, is_up, latency_ms, error)
         VALUES ($1, $2, $3, $4, $5)`,
        [entry.service, entry.checkedAt, entry.isUp, entry.latencyMs, entry.error],
      );
    });
  }

  async listRecent(service: string, limit: number): Promise<readonly ServiceUptimeCheckRecord[]> {
    return this.db.withoutTenant(async (s) => {
      const r = await s.query<Row>(
        `SELECT service, checked_at, is_up, latency_ms, error
         FROM service_uptime_checks
         WHERE service = $1
         ORDER BY checked_at DESC
         LIMIT $2`,
        [service, limit],
      );
      return r.rows.map((row) => ({
        service: row.service,
        checkedAt: new Date(row.checked_at),
        isUp: row.is_up,
        latencyMs: row.latency_ms,
        error: row.error,
      }));
    });
  }

  async sweepExpired(olderThanDays: number): Promise<void> {
    await this.db.withoutTenant((s) =>
      s.query(`DELETE FROM service_uptime_checks WHERE checked_at < now() - ($1 || ' days')::interval`, [String(olderThanDays)]),
    );
  }
}
