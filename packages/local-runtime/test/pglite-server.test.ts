/**
 * The two-phase open the whole local build rests on (issue #3716 spike, reproduced as a test):
 * owner phase can DDL + create roles, app phase serves as `app_rw` with RLS in force, and a
 * pool of connections works through the socket multiplexer.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { ensureDatabaseExists, startPgliteServer } from "../src/pglite-server";

const dir = mkdtempSync(join(tmpdir(), "wsx-pglite-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function freePort(): Promise<number> {
  const net = await import("node:net");
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
  });
}

describe("pglite two-phase server", () => {
  it("owner phase migrates, app phase serves as app_rw with RLS and pooled connections", async () => {
    const dataDir = join(dir, "pgdata");
    expect(await ensureDatabaseExists(dataDir)).toBe(true);
    expect(await ensureDatabaseExists(dataDir)).toBe(false);
    const port = await freePort();

    const owner = await startPgliteServer({ dataDir, port, username: "postgres" });
    const o = new pg.Client({ host: "127.0.0.1", port, user: "postgres", password: "x", database: "workspacex" });
    await o.connect();
    await o.query("CREATE EXTENSION IF NOT EXISTS vector");
    await o.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_rw') THEN CREATE ROLE app_rw LOGIN; END IF; END $$");
    await o.query("CREATE TABLE t (org text, v vector(3)); ALTER TABLE t ENABLE ROW LEVEL SECURITY; GRANT SELECT, INSERT ON t TO app_rw");
    await o.query("CREATE POLICY p ON t USING (org = current_setting('app.org', true))");
    await o.query("INSERT INTO t VALUES ('a','[1,2,3]'),('b','[4,5,6]')");
    await o.end();
    await owner.stop();

    const app = await startPgliteServer({ dataDir, port, username: "app_rw" });
    const pool = new pg.Pool({ host: "127.0.0.1", port, user: "app_rw", password: "x", database: "workspacex", max: 6 });
    try {
      const who = await pool.query("select current_user");
      expect(who.rows[0].current_user).toBe("app_rw");
      const hidden = await pool.query("select count(*)::int as n from t");
      expect(hidden.rows[0].n).toBe(0); // RLS: no org context, no rows
      const c = await pool.connect();
      try {
        await c.query("begin");
        await c.query("select set_config('app.org','a',true)");
        const seen = await c.query("select org from t");
        expect(seen.rows.map((r) => r.org)).toEqual(["a"]);
        await c.query("rollback");
      } finally { c.release(); }
      const concurrent = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => pool.query("select $1::int as i, pg_sleep(0.05)", [i]).then((r) => r.rows[0].i)));
      expect(concurrent).toEqual([1, 2, 3, 4, 5, 6]);
      const vec = await pool.query("select '[1,2,3]'::vector <-> '[1,2,4]'::vector as d");
      expect(Number(vec.rows[0].d)).toBeCloseTo(1);
    } finally {
      await pool.end();
      await app.stop();
    }
  });
});

describe("port guard", () => {
  it("names another running instance instead of letting PGlite abort", async () => {
    const { assertPostgresPortFree } = await import("../src/pglite-server");
    const net = await import("node:net");
    const holder = net.createServer();
    const port = await new Promise<number>((r) => holder.listen(0, "127.0.0.1", () => r((holder.address() as { port: number }).port)));
    await expect(assertPostgresPortFree(port)).rejects.toThrow(/another WorkspaceX Local/);
    await new Promise<void>((r) => holder.close(() => r()));
    await expect(assertPostgresPortFree(port)).resolves.toBeUndefined();
  });
});
