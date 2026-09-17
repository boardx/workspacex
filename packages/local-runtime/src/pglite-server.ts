/**
 * PostgreSQL for one machine: PGlite (Postgres compiled to WASM, pgvector built in) behind
 * `pglite-socket`, so the unmodified API / seed scripts / Python service talk plain
 * PostgreSQL wire protocol to 127.0.0.1.
 *
 * ## Two phases, one data dir (spike result, issue #3716)
 *
 * pglite-socket ignores the client's login role: every connection IS the role the PGlite
 * instance was opened as. The API's RLS story requires the serving connection to be
 * `app_rw` (not the table owner), while migrations and seeds need the owner. So:
 *
 *   phase "owner"  -- open as `postgres`, run migrations + seeds, close;
 *   phase "app"    -- reopen the same data dir as `app_rw`, serve.
 *
 * Known deviation, accepted for a single-user loopback deployment: `session_user` stays
 * `postgres`, so `SET ROLE postgres` is not refused. The only client is our own API.
 */
import net from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { DB_NAME } from "./config";

export interface PgliteServerOptions {
  readonly dataDir: string;
  readonly port: number;
  readonly username: string;
  readonly maxConnections?: number;
}

export interface PgliteHandle {
  readonly port: number;
  readonly username: string;
  stop(): Promise<void>;
}

export async function startPgliteServer(opts: PgliteServerOptions): Promise<PgliteHandle> {
  await assertPostgresPortFree(opts.port);
  const db = await openPglite(opts.dataDir, () => PGlite.create({
    dataDir: opts.dataDir,
    extensions: { vector },
    username: opts.username,
    database: DB_NAME,
  }));
  const server = new PGLiteSocketServer({
    db,
    host: "127.0.0.1",
    port: opts.port,
    // Default is 1, and the API's pool (max 5) + pg-boss + Python would ECONNRESET.
    maxConnections: opts.maxConnections ?? 32,
  });
  await server.start();
  let stopped = false;
  return {
    port: opts.port,
    username: opts.username,
    async stop() {
      if (stopped) return;
      stopped = true;
      await server.stop();
      await db.close();
    },
  };
}

/**
 * PGlite is single-process: a second open of the same data dir aborts deep inside the WASM
 * build ("RuntimeError: Aborted()") with no readable cause, and so does a directory left
 * inconsistent by a hard kill. PGlite's own postmaster.pid carries a fake pid (-42), so it
 * cannot tell us who owns the directory; the port can. Anything already listening on our
 * PostgreSQL port is another WorkspaceX Local, and we say so instead of letting PGlite abort.
 */
export async function assertPostgresPortFree(port: number): Promise<void> {
  const inUse = await new Promise<boolean>((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(true));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(false)));
  });
  if (inUse) {
    throw new Error(
      `127.0.0.1:${port} is already in use -- another WorkspaceX Local is probably running; ` +
        "stop it first (Ctrl-C in its terminal, or: lsof -ti :" + port + " | xargs kill)",
    );
  }
}

/** Turn PGlite's opaque WASM abort into an actionable message. */
async function openPglite<T>(dataDir: string, open: () => Promise<T>): Promise<T> {
  try {
    return await open();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Aborted\(\)/.test(msg)) {
      throw new Error(
        `PGlite could not open ${dataDir}: it is either open in another process or was left ` +
          "inconsistent by a hard kill. If no other WorkspaceX Local is running, move the " +
          "directory aside (it is rebuilt from migrations + seeds) and start again.",
      );
    }
    throw e;
  }
}

/**
 * The very first open of a data dir creates the cluster as `postgres` with database
 * `postgres`; `workspacex` must exist before anything opens with `database: DB_NAME`.
 */
export async function ensureDatabaseExists(dataDir: string): Promise<boolean> {
  const db = await openPglite(dataDir, () => PGlite.create({ dataDir, extensions: { vector } }));
  try {
    const r = await db.query<{ n: number }>("select count(*)::int as n from pg_database where datname = $1", [DB_NAME]);
    if ((r.rows[0]?.n ?? 0) > 0) return false;
    await db.exec(`CREATE DATABASE ${DB_NAME}`);
    return true;
  } finally {
    await db.close();
  }
}
