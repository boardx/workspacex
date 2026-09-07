import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, it, vi } from "vitest";
import type { LogFields } from "../../src/application/ports/logger.port";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig, migrationConfig } from "../../src/infrastructure/db/pg-config";

it("terminating only its own borrowed backend rejects the waiting transaction without replay; another transaction succeeds", async () => {
  // No provisioning or service control: root supplies an existing isolated test DB.
  const database = process.env.WORKSPACEX_DB;
  expect(database).toBeTruthy();
  // db-global-setup already applies assertIsolatedDatabase. In particular,
  // an explicitly declared workspacex DB is valid on an isolated CI runner.
  // The termination below is independently restricted to our exact PID/marker.
  expect(appConfig().database).toBe(database);
  const marker = `disconnect-test-${randomUUID()}`;
  let observed!: () => void;
  const disconnected = new Promise<void>(resolve => { observed = resolve; });
  const logger = { info: vi.fn((_message: string, fields: LogFields) => {
    if (fields.code === "57P01") observed();
  }), error: vi.fn() };
  const db = new PgDatabase(appConfig(), logger);
  const admin = new pg.Client(migrationConfig());
  admin.on("error", () => undefined);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let ready!: (pid: number) => void;
  const entered = new Promise<number>(resolve => { ready = resolve; });
  const work = vi.fn(async (session: Parameters<Parameters<PgDatabase["withoutTenant"]>[0]>[0]) => {
    await session.query("SELECT set_config('application_name', $1, true)", [marker]);
    const result = await session.query<{pid: number}>("SELECT pg_backend_pid() AS pid");
    ready(result.rows[0]!.pid);
    await gate; // Deliberately no active SQL: this is the formerly fatal Client event window.
    return "must not commit";
  });
  const pending = db.withoutTenant(work).then(value => ({value, error: undefined}), error => ({value: undefined, error}));
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await admin.connect();
    const pid = await entered;
    // Exact PID AND a fresh random application marker AND current database. Never
    // terminate all sessions of a database, and never target a shared app connection.
    const terminated = await admin.query<{terminated: boolean}>(`SELECT pg_terminate_backend(pid) AS terminated
      FROM pg_stat_activity WHERE pid=$1 AND application_name=$2 AND datname=current_database()
      AND pid<>pg_backend_pid()`, [pid, marker]);
    expect(terminated.rows).toEqual([{terminated: true}]);
    await Promise.race([disconnected, new Promise<never>((_, reject) => {
      deadline = setTimeout(() => reject(new Error("own backend disconnect was not observed within 10s")), 10_000);
    })]);
    release();
    const outcome = await pending;
    expect(outcome.value).toBeUndefined();
    expect(outcome.error).toMatchObject({code: "57P01"});
    expect(work).toHaveBeenCalledTimes(1);
    const next = await db.withoutTenant(async session => (await session.query<{pid: number; ok: number}>("SELECT pg_backend_pid() AS pid, 1 AS ok")).rows[0]!);
    expect(next.ok).toBe(1);
    expect(next.pid).not.toBe(pid);
    expect(work).toHaveBeenCalledTimes(1);
  } finally {
    if (deadline) clearTimeout(deadline);
    release();
    await pending;
    await admin.end();
    await db.close();
  }
}, 30_000);
