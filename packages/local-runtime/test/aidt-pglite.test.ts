/** Real local PostgreSQL-WASM: all migrations, tenant boundaries, append-only grants,
 * and A/B rows surviving owner/app role switches and reopening the durable data directory.
 * This is a database test, not a claim of browser login, model or API-service acceptance.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { expect, it } from "vitest";
import { DB_APP_ROLE, DB_NAME, DB_OWNER_ROLE, resolveLocalConfig, paths } from "../src/config";
import { ensureDatabaseExists, startPgliteServer, type PgliteHandle } from "../src/pglite-server";
import { runMigrations } from "../src/seeds";
const root = fileURLToPath(new URL("../../..", import.meta.url));
const content = { schemaVersion: 1, draft: { fields: { topic: "student-owned local draft" }, ideas: [], selectedIdeaId: "" } };
it("persists A+B on native PGlite with FORCE RLS, archive policies and append-only constraints", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "wsx-aidt-pglite-"));
  let server: PgliteHandle | undefined;
  let client: pg.Client | undefined;
  let cfg = resolveLocalConfig({ repoRoot: root, dataDir });
  const closeClient = async () => { if (client) { const old = client; client = undefined; await old.end(); } };
  const open = async (username: string) => {
    await closeClient(); await server?.stop();
    server = await startPgliteServer({ dataDir: paths.pgData(cfg), port: 0, username });
    cfg = { ...cfg, ports: { ...cfg.ports, postgres: server.port } };
    client = new pg.Client({ host: "127.0.0.1", port: server.port, user: username, password: "local", database: DB_NAME });
    await client.connect(); return client;
  };
  const tenant = async <T>(orgId: string, work: (db: pg.Client) => Promise<T>): Promise<T> => {
    const db = client!; await db.query("BEGIN");
    try { await db.query("SELECT set_config('app.current_org',$1,true)", [orgId]); const result = await work(db); await db.query("COMMIT"); return result; }
    catch (error) { await db.query("ROLLBACK"); throw error; }
  };
  try {
    await ensureDatabaseExists(paths.pgData(cfg));
    await open(DB_OWNER_ROLE);
    // Migration CLI shares one server backend; release this idle connection while it runs.
    await closeClient();
    await runMigrations(cfg, () => {});
    const owner = await open(DB_OWNER_ROLE);
    const tables = await owner.query(`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class
      WHERE relname IN ('aidt_stage_revisions','project_member_chat_channels','project_member_chat_messages') ORDER BY relname`);
    expect(tables.rows).toHaveLength(3);
    expect(tables.rows.every(row => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    for (const id of ["aidt-local-a", "aidt-local-b"]) {
      await owner.query("INSERT INTO organizations(id,name,kind,seat_quota) VALUES($1,$1,'organization',10)", [id]);
      await owner.query("INSERT INTO projects(id,org_id,name,kind,status) VALUES($1,$2,$1,'general','active')", [id + "-project", id]);
      await owner.query("INSERT INTO general_projects(id,org_id) VALUES($1,$2)", [id + "-project", id]);
    }
    const app = await open(DB_APP_ROLE);
    expect((await app.query("SELECT current_user")).rows[0].current_user).toBe(DB_APP_ROLE);
    await tenant("aidt-local-a", async db => {
      await db.query(`INSERT INTO aidt_stage_revisions(org_id,project_id,stage_id,revision,content,source_stage_revisions,updated_by,operation_id,request_key)
        VALUES('aidt-local-a','aidt-local-a-project',1,1,$1::jsonb,'[]','local-student','11111111-1111-4111-8111-111111111111','stable-request')`, [JSON.stringify(content)]);
      await db.query("INSERT INTO project_member_chat_channels(org_id,project_id) VALUES('aidt-local-a','aidt-local-a-project')");
      await db.query("UPDATE project_member_chat_channels SET last_sequence=1 WHERE org_id='aidt-local-a' AND project_id='aidt-local-a-project'");
      await db.query(`INSERT INTO project_member_chat_messages(org_id,project_id,id,sequence,author_id,client_message_id,text)
        VALUES('aidt-local-a','aidt-local-a-project','22222222-2222-4222-8222-222222222222',1,'local-student','33333333-3333-4333-8333-333333333333','真实本地文字持久化')`);
      expect((await db.query("SELECT count(*)::int AS n FROM aidt_stage_revisions")).rows[0].n).toBe(1);
      expect((await db.query("SELECT count(*)::int AS n FROM project_member_chat_messages")).rows[0].n).toBe(1);
    });
    await tenant("aidt-local-b", async db => {
      expect((await db.query("SELECT count(*)::int AS n FROM aidt_stage_revisions")).rows[0].n).toBe(0);
      expect((await db.query("SELECT count(*)::int AS n FROM project_member_chat_messages")).rows[0].n).toBe(0);
    });
    await expect(tenant("aidt-local-b", db => db.query(`INSERT INTO project_member_chat_channels(org_id,project_id)
      VALUES('aidt-local-a','aidt-local-a-project')`))).rejects.toMatchObject({ code: "42501" });
    await expect(tenant("aidt-local-a", db => db.query("UPDATE aidt_stage_revisions SET request_key='overwrite'"))).rejects.toMatchObject({ code: "42501" });
    await expect(tenant("aidt-local-a", db => db.query("DELETE FROM project_member_chat_messages"))).rejects.toMatchObject({ code: "42501" });
    await expect(tenant("aidt-local-a", db => db.query(`INSERT INTO project_member_chat_messages(org_id,project_id,id,sequence,author_id,client_message_id,text)
      VALUES('aidt-local-a','aidt-local-a-project','44444444-4444-4444-8444-444444444444',2,'local-student','33333333-3333-4333-8333-333333333333','duplicate receipt')`))).rejects.toMatchObject({ code: "23505" });
    // Reopen the SAME persisted DB with a new server/backend; no TTL fixture or reseed.
    await open(DB_APP_ROLE);
    await tenant("aidt-local-a", async db => {
      expect((await db.query("SELECT content FROM aidt_stage_revisions")).rows[0].content).toEqual(content);
      expect((await db.query("SELECT text FROM project_member_chat_messages")).rows[0].text).toBe("真实本地文字持久化");
      expect((await db.query("SELECT last_sequence::int AS n FROM project_member_chat_channels")).rows[0].n).toBe(1);
    });
    const archive = await open(DB_OWNER_ROLE);
    await archive.query("UPDATE projects SET status='archived' WHERE id='aidt-local-a-project'");
    await open(DB_APP_ROLE);
    await tenant("aidt-local-a", async db => expect((await db.query("SELECT count(*)::int AS n FROM project_member_chat_messages")).rows[0].n).toBe(1));
    await expect(tenant("aidt-local-a", db => db.query(`INSERT INTO aidt_stage_revisions(org_id,project_id,stage_id,revision,content,source_stage_revisions,updated_by,operation_id,request_key)
      VALUES('aidt-local-a','aidt-local-a-project',1,2,$1::jsonb,'[]','local-student','55555555-5555-4555-8555-555555555555','archived-write')`, [JSON.stringify(content)]))).rejects.toMatchObject({ code: "42501" });
    await expect(tenant("aidt-local-a", db => db.query("UPDATE project_member_chat_channels SET last_sequence=2"))).rejects.toMatchObject({ code: "42501" });
  } finally { await closeClient(); await server?.stop(); rmSync(dataDir, { recursive: true, force: true }); }
}, 180_000);
