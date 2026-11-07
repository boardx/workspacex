import pg from "pg";
import { ensureDatabaseExists, startPgliteServer, type PgliteHandle } from "../../src/pglite-server";

/** Each operation atomically owns its OS-assigned listener and closes only that handle. */
export async function withServer<T>(dataDir: string, fn: (h: PgliteHandle) => Promise<T>): Promise<T> {
  await ensureDatabaseExists(dataDir);
  const h = await startPgliteServer({ dataDir, port: 0, username: "postgres" });
  try { return await fn(h); } finally { await h.stop(); }
}

export async function withDb<T>(dataDir: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  return withServer(dataDir, async (h) => {
    const c = new pg.Client({ host: "127.0.0.1", port: h.port, user: "postgres", database: "workspacex" });
    try {
      await c.connect();
      return await fn(c);
    } finally { await c.end(); }
  });
}
