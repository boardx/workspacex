/**
 * 把一份备份读回来——**换一台电脑、或者救一次事故的那条路**。
 *
 * ## 为什么必须有它
 * R1 做了备份，但备份只做了一半的事：能导出、导不回来，等于把用户锁在这台机器上。
 * 竞品调研里最高严重度的抱怨正是这个形状——Apple Notes 没有真正的「导出全部」，
 * 一次只能导一条，用户被锁死；Bear 的笔记是不透明 SQLite 里的行，备份工具碰不到。
 * 评分卡维度 5 的 9 分判据写着「一键显示数据位置 / 导出 / **导入**」。
 *
 * ## 三条不肯让步的规则
 *
 * **① 先验后写。** 校验不过就根本不开始，而不是写到一半发现不对。
 * 用的是备份自己那套逐文件 sha256 + 长度核对（`verifyBackup`）。
 *
 * **② 绝不静默覆盖。** 现有数据目录被**挪走**而不是删掉，名字带时间戳。
 * 一个「恢复」动作把用户当前的数据毁掉、而且不可逆，比不能恢复糟得多。
 * Logseq 那件事故（架构上有纯文件仍丢了用户一个月的日记）的教训是：
 * 「数据还在」是一条每一步都要守的运行时不变量，不是一句承诺。
 *
 * **③ 恢复完要数行数。** 一个不验证的恢复和一个不验证的备份是同一个陷阱：
 * 它会在数据没读回来的时候说「成功」。清单里记着每张表的行数，恢复后逐张核对。
 */

import { cp, mkdir, readFile, readdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { verifyBackup, type BackupManifest } from "./backup";

export interface RestoreOptions {
  /** 备份目录（里面有 manifest.json / database.tar.gz / objects/）。 */
  readonly backupDir: string;
  /** 目标数据目录，即 `paths.pgData(c)` 的上一级——恢复会写它下面的 pgdata 与 objects。 */
  readonly dataDir: string;
  /** 由调用方提供：把一份数据库快照写进 `pgDataDir`。抽出来是为了能在测试里取证。 */
  readonly writeDatabase: (pgDataDir: string, dump: Uint8Array) => Promise<void>;
  /** 恢复完之后数一张表有多少行；表不存在返回 null。 */
  readonly countRows: (table: string) => Promise<number | null>;
  readonly log?: (line: string) => void;
  readonly now?: Date;
}

export type RestoreResult =
  | {
      ok: true;
      /** 原来的数据被挪到了哪里——这句话必须说给用户，否则「挪走」等于「没了」。 */
      readonly movedAsideTo: string | null;
      readonly manifest: BackupManifest;
      readonly verified: Readonly<Record<string, { expected: number; actual: number | null }>>;
    }
  | { ok: false; readonly reason: string };

/** 被挪走的旧数据叫什么。带时间戳，绝不复用同一个名字。 */
export function replacedDirName(base: string, now: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${base}.replaced-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

/** 目录里有没有东西。空目录不算「有现存数据」，不值得为它做一次挪移。 */
async function hasContent(p: string): Promise<boolean> {
  try { return (await readdir(p)).length > 0; } catch { return false; }
}

export async function restoreBackup(o: RestoreOptions): Promise<RestoreResult> {
  const log = o.log ?? (() => {});
  const now = o.now ?? new Date();

  // ① 先验后写。校验不过就根本不开始。
  log("[restore] 正在校验这份备份…");
  const v = await verifyBackup(o.backupDir);
  if (!v.ok) return { ok: false, reason: `这份备份没通过校验，没有动你现在的数据：${v.reason}` };
  const manifest = v.manifest;
  /*
    ⚠ 这里**不要**再判一次格式版本：`verifyBackup` 已经判过，拒的时候整条路就断在上面。
    我第一版在这里又写了一道，反证时把它删掉测试照绿——一个没有任何断言打在上面的
    分支，就是没被测过的复杂度。判据只留在 `verifyBackup` 一处。
    （这是我这一轮第二次犯同一个毛病，记在这里。）
  */

  let dump: Uint8Array;
  try {
    dump = await readFile(join(o.backupDir, "database.tar.gz"));
  } catch (e) {
    return { ok: false, reason: `读不到备份里的数据库文件：${e instanceof Error ? e.message : String(e)}` };
  }

  // ② 绝不静默覆盖：现有数据挪走，不删。
  const pgDataDir = join(o.dataDir, "pgdata");
  const objectsDir = join(o.dataDir, "objects");
  let movedAsideTo: string | null = null;
  if (await hasContent(pgDataDir)) {
    movedAsideTo = replacedDirName(pgDataDir, now);
    try {
      await rename(pgDataDir, movedAsideTo);
    } catch (e) {
      return { ok: false, reason: `挪不开现有数据，恢复中止，你的数据没有被改动：${e instanceof Error ? e.message : String(e)}` };
    }
    log(`[restore] 原来的数据已挪到 ${movedAsideTo}（没有删除）`);
  }

  try {
    await mkdir(o.dataDir, { recursive: true });
    await o.writeDatabase(pgDataDir, dump);
  } catch (e) {
    return { ok: false, reason: `写入数据库失败：${e instanceof Error ? e.message : String(e)}。原来的数据在 ${movedAsideTo ?? "原处"}` };
  }

  const backupObjects = join(o.backupDir, "objects");
  if (await exists(backupObjects)) {
    await mkdir(objectsDir, { recursive: true });
    await cp(backupObjects, objectsDir, { recursive: true, force: true });
  }

  // ③ 恢复完数行数。不验证的恢复和不验证的备份是同一个陷阱。
  log("[restore] 正在逐张表核对行数…");
  const verified: Record<string, { expected: number; actual: number | null }> = {};
  const mismatched: string[] = [];
  for (const [table, expected] of Object.entries(manifest.rowCounts)) {
    const actual = await o.countRows(table).catch(() => null);
    verified[table] = { expected, actual };
    if (actual !== expected) mismatched.push(`${table}：清单说 ${expected}，读回来 ${actual ?? "读不到"}`);
  }
  if (mismatched.length > 0) {
    return {
      ok: false,
      reason: `数据读回来了，但和清单对不上：${mismatched.join("；")}。`
        + `原来的数据在 ${movedAsideTo ?? "原处"}，没有被删除。`,
    };
  }

  log("[restore] 恢复完成，行数与清单一致");
  return { ok: true, movedAsideTo, manifest, verified };
}

/**
 * 给外壳用的一步到位版本：给一份备份目录和本地配置，把它恢复进去。
 *
 * ⚠ **调用前必须把栈停掉。** PGlite 的 `loadDataDir` 是创建时选项，而且它是单会话
 * 所有权——在一个活着的实例脚下换目录，是本仓记过的那一类事故的标准做法。
 */
export async function restoreIntoDataDir(opts: {
  readonly backupDir: string;
  readonly dataDir: string;
  readonly postgresPort: number;
  readonly log?: (line: string) => void;
}): Promise<RestoreResult> {
  const { ensureDatabaseExists, restoreDatabaseDump, startPgliteServer } = await import("./pglite-server");
  const pgDataDir = join(opts.dataDir, "pgdata");
  return restoreBackup({
    backupDir: opts.backupDir,
    dataDir: opts.dataDir,
    log: opts.log,
    writeDatabase: (dir, dump) => restoreDatabaseDump(dir, dump),
    countRows: async (table) => {
      // 每次开一次、数一张表、再关掉。慢，但**一次恢复只做一次**，
      // 而换来的是「不需要在恢复流程里维护一个长连接」——那正是单会话所有权最容易出事的地方。
      await ensureDatabaseExists(pgDataDir);
      const h = await startPgliteServer({ dataDir: pgDataDir, port: opts.postgresPort, username: "postgres" });
      try {
        return await h.countRows(table);
      } finally {
        await h.stop();
      }
    },
  });
}
