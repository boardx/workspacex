// drop-database.ts — 拆掉「本文件自己拥有的那个库」的正确姿势（#487）。
//
// 事故：`DROP DATABASE … WITH (FORCE)` 会给还连着的会话发 FATAL `57P01`
// （terminating connection due to administrator command）。如果某个 fixture 还没
// 把连接还回来，这个 FATAL 会以**运行期错误**的形式冒到 vitest 里——于是出现
// 「426 个文件、4352 个测试全过，Errors 1」这种 run：**零个断言失败，job 却是红的**，
// 而错误对象是一坨 3KB 的序列化结构，既不说是谁泄的连接，也不说该改哪里。
//
// FORCE 本身不是 bug，它是**把诊断信息扔掉的那一步**：它把「有 fixture 漏关连接」
// 这条可定位的事实，翻译成了一条谁也读不懂的 FATAL。
//
// 这里的做法：
//   ① 先 REVOKE CONNECT，挡住新连接进来（否则边排空边有人连进来，永远排不空）；
//   ② 轮询 pg_stat_activity 等已有连接自然归还（正常情况下毫秒级）；
//   ③ 宽限期到了还有残留 —— **指名道姓**：pid / application_name / state / query；
//   ④ 然后才显式 terminate 并 DROP（不带 FORCE），让拆除动作本身一定成功；
//   ⑤ 最后**抛一个说人话的错误**。泄漏是 fixture 卫生问题，不该被吞掉——但它必须
//      以「谁泄的」这种可行动的形式失败，而不是一条匿名 FATAL。
import type pg from "pg";

export interface LeakedConnection {
  pid: number;
  applicationName: string;
  state: string;
  query: string;
}

export interface DropDatabaseOptions {
  /** 等已有连接自然归还的宽限期（毫秒）。默认 2000。 */
  graceMs?: number;
  /** 轮询间隔（毫秒）。默认 50。 */
  pollMs?: number;
  /** 残留连接时是否抛错。默认 true——泄漏不该被静默吞掉。 */
  throwOnLeak?: boolean;
}

async function liveConnections(admin: pg.Client, database: string): Promise<LeakedConnection[]> {
  const { rows } = await admin.query<{
    pid: number;
    application_name: string;
    state: string;
    query: string;
  }>(
    `SELECT pid, application_name, state, query
       FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [database],
  );
  return rows.map((row) => ({
    pid: row.pid,
    applicationName: row.application_name || "(未命名)",
    state: row.state || "(未知)",
    query: (row.query || "").slice(0, 120),
  }));
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 排空后拆库。返回宽限期结束时仍残留的连接（空数组 = 拆得干干净净）。
 * `throwOnLeak` 为真（默认）时，拆完仍会抛出一个指名道姓的错误。
 */
export async function dropDatabaseAfterDraining(
  admin: pg.Client,
  database: string,
  options: DropDatabaseOptions = {},
): Promise<LeakedConnection[]> {
  const graceMs = options.graceMs ?? 2_000;
  const pollMs = options.pollMs ?? 50;
  const throwOnLeak = options.throwOnLeak ?? true;

  // ① 挡住新连接。库可能已不存在（IF EXISTS 语义），失败不致命。
  await admin.query(`REVOKE CONNECT ON DATABASE ${database} FROM PUBLIC`).catch(() => undefined);

  // ② 等已有连接归还
  let leaked = await liveConnections(admin, database);
  const deadline = Date.now() + graceMs;
  while (leaked.length > 0 && Date.now() < deadline) {
    await sleep(pollMs);
    leaked = await liveConnections(admin, database);
  }

  // ③④ 残留就显式终止（而不是靠 DROP 的 FORCE 隐式发 FATAL），再拆
  if (leaked.length > 0) {
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [database],
    );
    // 终止是异步的，等后端真的消失再 DROP，否则 DROP 仍会报 "being accessed by other users"
    const dropDeadline = Date.now() + 5_000;
    while ((await liveConnections(admin, database)).length > 0 && Date.now() < dropDeadline) {
      await sleep(pollMs);
    }
  }
  await admin.query(`DROP DATABASE IF EXISTS ${database}`);

  // ⑤ 说人话
  if (leaked.length > 0 && throwOnLeak) {
    const who = leaked
      .map((c) => `  · pid=${c.pid} application_name=${c.applicationName} state=${c.state} query=${c.query}`)
      .join("\n");
    throw new Error(
      `[test-isolation] 拆库 ${database} 时仍有 ${leaked.length} 条活连接（已等 ${graceMs}ms）。\n` +
        `库已拆掉，但这是 fixture 没有归还连接——请在 afterAll 里 await 对应的 close()/end()：\n${who}`,
    );
  }
  return leaked;
}
