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
import { DB_NAME, DB_OWNER_ROLE } from "./config";
import { SessionAwareQueryQueue } from "./pglite-queue";
import { assertPortFree } from "./processes";

export interface PgliteServerOptions {
  readonly dataDir: string;
  readonly port: number;
  readonly username: string;
  readonly maxConnections?: number;
}

export interface PgliteHandle {
  readonly port: number;
  readonly username: string;
  /**
   * 一致快照。**备份必须走这里，不能去拷 `pgdata` 目录**——应用还在写的时候拷到的是
   * 撕裂的状态，那是这一类应用最经典的损坏来源。这个方法由持有数据库的实例自己产出。
   */
  dumpDatabase(): Promise<Uint8Array>;
  /** 表不存在时返回 null，不要返回 0：备份收据上「0 条」和「这张表没有」不是一回事。 */
  countRows(table: string): Promise<number | null>;
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
  // Replace the per-message queue with a session-aware one (see pglite-queue.ts): the
  // built-in one interleaves clients between Parse and Bind and shares statement names.
  const queue = new SessionAwareQueryQueue(db);
  queue.onIdleRelease = (i) => console.warn(`[pglite] backend taken from idle connection #${i.handlerId} after ${i.heldMs}ms (why=${i.why} types=${i.lastTypes}) last sql: ${i.lastSql}`);
  queue.onLongWait = (i) => console.warn(`[pglite] connection #${i.handlerId} waited ${i.waitedMs}ms for the backend (busy: #${i.busyHandlerId} ${i.busySql || "?"}; queued=${i.queued})`);
  (server as unknown as { queryQueue: unknown }).queryQueue = queue;
  await server.start();
  let stopped = false;
  return {
    port: opts.port,
    username: opts.username,
    async dumpDatabase() {
      const blob = await db.dumpDataDir("gzip");
      return new Uint8Array(await blob.arrayBuffer());
    },
    async countRows(table: string) {
      // 表名不进字符串拼接的参数位：这里只接受本仓自己写死的白名单（RECEIPT_TABLES），
      // 但仍然显式校验一次形状——将来有人把用户输入接到这里时，这道检查还在。
      if (!/^[a-z_][a-z0-9_]*$/.test(table)) return null;
      try {
        const r = await db.query<{ n: number | string }>(`SELECT count(*)::int AS n FROM ${table}`);
        const n = r.rows[0]?.n;
        return typeof n === "number" ? n : typeof n === "string" ? Number(n) : null;
      } catch {
        return null;   // 表不存在 / 权限不足：如实说「没有」，不要编 0
      }
    },
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
/**
 * 把一份 `dumpDataDir()` 产出的快照**物化**成一个可用的数据目录。
 *
 * PGlite 的 `loadDataDir` 是**创建时**选项，所以恢复必须在数据库还没被打开的时候做——
 * 这也是为什么桌面壳的恢复流程要先停栈：在一个活着的实例上换掉它脚下的目录，
 * 是 PGlite 单会话所有权那一类事故的标准做法。
 */
export async function restoreDatabaseDump(pgDataDir: string, dump: Uint8Array): Promise<void> {
  const db = await PGlite.create({
    dataDir: pgDataDir,
    extensions: { vector },
    username: DB_OWNER_ROLE,
    database: DB_NAME,
    loadDataDir: new Blob([dump]),
  });
  await db.close();
}

export async function assertPostgresPortFree(port: number): Promise<void> {
  await assertPortFree(port, "PostgreSQL");
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
