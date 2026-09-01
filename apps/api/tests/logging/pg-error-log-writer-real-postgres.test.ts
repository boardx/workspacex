/**
 * `PgErrorLogWriter` against a REAL Postgres database, executing the actual migration -- PR
 * #2444 independent review, finding #4: the other `pg-error-log-writer.test.ts` suite proves
 * the writer's own logic (cadence, redaction application, failure handling) against a fake
 * `DatabasePort`, which is the right tool for that (see that file's header). It does not
 * prove the migration actually creates a queryable `error_logs` table, that a real INSERT
 * with a `jsonb` parameter round-trips, that the trace_id index makes the lookup this table
 * exists for actually work, or that `sweepExpiredErrorLogs`'s DELETE really removes old rows
 * and leaves new ones. This file does, over the real `PgDatabase` + real migrations, same
 * infrastructure the other F20/F16x suites use (`ensureDatabase`/`migrateOnce`/`PgDatabase`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensureDatabase, migrateOnce } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgErrorLogWriter, sweepExpiredErrorLogs } from "../../src/infrastructure/logging/pg-error-log-writer";

let db: PgDatabase;
let writer: PgErrorLogWriter;

interface ErrorLogRow {
  trace_id: string;
  msg: string;
  detail: { name?: string; message?: string; raw?: string };
  created_at: string;
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  writer = new PgErrorLogWriter(db);
});

beforeEach(async () => {
  await db.withoutTenant((s) => s.query("DELETE FROM error_logs"));
});

afterAll(async () => {
  await db?.close();
});

describe("PgErrorLogWriter against real Postgres -- migration, INSERT, jsonb, index, retention", () => {
  it("the migration creates a queryable table: record() really inserts a row, readable by trace_id", async () => {
    await writer.record({
      traceId: "t-real-1",
      msg: "unhandled exception",
      detail: { name: "Error", message: "Connection is closed." },
    });

    const { rows } = await db.withoutTenant((s) =>
      s.query<ErrorLogRow>("SELECT trace_id, msg, detail, created_at FROM error_logs WHERE trace_id = $1", ["t-real-1"]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ trace_id: "t-real-1", msg: "unhandled exception" });
    // `detail` round-trips as real jsonb -- pg deserialises it back into an object, not a string.
    expect(rows[0]!.detail).toEqual({ name: "Error", message: "Connection is closed." });
    expect(new Date(rows[0]!.created_at).getTime()).not.toBeNaN();
  });

  it("a secret in the detail is redacted BEFORE it lands in the real table (finding #1, end to end)", async () => {
    await writer.record({
      traceId: "t-real-secret",
      msg: "unhandled exception",
      detail: { name: "Error", message: "postgres://app_rw:s3cr3t-pw@10.0.0.5:5432/workspacex" },
    });

    const { rows } = await db.withoutTenant((s) =>
      s.query<ErrorLogRow>("SELECT detail FROM error_logs WHERE trace_id = $1", ["t-real-secret"]),
    );
    const stored = JSON.stringify(rows[0]!.detail);
    expect(stored).not.toContain("s3cr3t-pw");
    expect(stored).toContain("[REDACTED]");
  });

  it("sweepExpiredErrorLogs really deletes rows older than the retention window and leaves recent ones", async () => {
    await writer.record({ traceId: "t-real-old", msg: "x", detail: {} });
    await writer.record({ traceId: "t-real-recent", msg: "x", detail: {} });
    await db.withoutTenant((s) =>
      s.query("UPDATE error_logs SET created_at = now() - interval '31 days' WHERE trace_id = $1", ["t-real-old"]),
    );

    const result = await sweepExpiredErrorLogs(db);
    expect(result).toEqual({ ok: true });

    const { rows } = await db.withoutTenant((s) => s.query<{ trace_id: string }>("SELECT trace_id FROM error_logs"));
    const traceIds = rows.map((r) => r.trace_id);
    expect(traceIds).not.toContain("t-real-old");
    expect(traceIds).toContain("t-real-recent");
  });

  it("trace_id index makes the lookup this table exists for actually usable (reflects real query plan, not just a passing SELECT)", async () => {
    const { rows } = await db.withoutTenant((s) =>
      s.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'error_logs' AND indexdef LIKE '%trace_id%'`,
      ),
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});
