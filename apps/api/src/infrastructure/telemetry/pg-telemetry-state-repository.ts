/** D9 —— `instance_telemetry_state`（单行）的 PostgreSQL 实现。见迁移 `20260924180000_instance_telemetry_state.sql`。 */
import { randomBytes } from "node:crypto";
import { instanceTelemetry as T } from "@repo/contracts";
import type { DatabasePort } from "../../application/ports/database.port";
import type { TelemetryConsent, TelemetryStateRepository, TelemetryStateRow } from "../../application/telemetry/telemetry-ports";

interface Row {
  install_secret: string;
  consent_health: boolean;
  consent_usage: boolean;
  consent_diagnostics: boolean;
  consent_benchmark: boolean;
  last_attempted_at: Date | null;
  last_outcome: "sent" | "failed" | "invalid" | null;
  last_omitted: T.TelemetryConsentItemValue[] | null;
  last_report: unknown;
}

const COLS = `install_secret, consent_health, consent_usage, consent_diagnostics, consent_benchmark,
  last_attempted_at, last_outcome, last_omitted, last_report`;

function consentOf(r: Row): TelemetryConsent {
  return { health: r.consent_health, usage: r.consent_usage, diagnostics: r.consent_diagnostics, benchmark: r.consent_benchmark };
}

export class PgTelemetryStateRepository implements TelemetryStateRepository {
  constructor(private readonly db: DatabasePort) {}

  async ensure(): Promise<TelemetryStateRow> {
    const d = T.TELEMETRY_CONSENT_DEFAULTS;
    return this.db.withoutTenant(async (s) => {
      await s.query(
        `INSERT INTO instance_telemetry_state (singleton, install_secret, consent_health, consent_usage, consent_diagnostics, consent_benchmark)
         VALUES (true, $1, $2, $3, $4, $5) ON CONFLICT (singleton) DO NOTHING`,
        [randomBytes(32).toString("hex"), d.health, d.usage, d.diagnostics, d.benchmark],
      );
      const r = (await s.query<Row>(`SELECT ${COLS} FROM instance_telemetry_state WHERE singleton`)).rows[0];
      if (!r) throw new Error("instance_telemetry_state row missing right after ensure");
      return {
        installSecret: r.install_secret,
        consent: consentOf(r),
        last: r.last_attempted_at && r.last_outcome
          ? { attemptedAt: new Date(r.last_attempted_at), outcome: r.last_outcome, omittedForLackOfData: r.last_omitted ?? [], report: r.last_report }
          : null,
      };
    });
  }

  async updateConsent(patch: Partial<TelemetryConsent>): Promise<TelemetryConsent> {
    const cur = (await this.ensure()).consent;
    const next = { ...cur, ...patch };
    await this.db.withoutTenant(async (s) => {
      await s.query(
        `UPDATE instance_telemetry_state
            SET consent_health = $1, consent_usage = $2, consent_diagnostics = $3, consent_benchmark = $4, updated_at = now()
          WHERE singleton`,
        [next.health, next.usage, next.diagnostics, next.benchmark],
      );
    });
    return next;
  }

  async recordAttempt(a: NonNullable<TelemetryStateRow["last"]>): Promise<void> {
    await this.db.withoutTenant(async (s) => {
      await s.query(
        `UPDATE instance_telemetry_state
            SET last_attempted_at = $1, last_outcome = $2, last_omitted = $3::jsonb, last_report = $4::jsonb, updated_at = now()
          WHERE singleton`,
        [a.attemptedAt, a.outcome, JSON.stringify(a.omittedForLackOfData), JSON.stringify(a.report)],
      );
    });
  }
}
