/**
 * 本地版的数据备份与校验。
 *
 * ## 为什么不是「把目录拷走」
 * 直接 `cp -R pgdata` 是这一类应用最经典的损坏来源：应用还在写，拷到的是撕裂的状态
 * （SQLite 官方那份腐坏清单里「热 journal 与主库分离」就是同一个形状，
 * <https://sqlite.org/howtocorrupt.html>）。PGlite 自己的 `dumpDataDir()` 由持有数据库的
 * 那个实例产出，是一致快照——备份必须走它。
 *
 * ## 为什么要有清单和校验
 * 评分卡维度 5 要求「备份自己被校验过」。竞品调研里最高严重度的抱怨就是
 * 「数据丢了或打不开了」，而 Logseq 的教训是：**「数据落盘了」是一条每次都要验的
 * 运行时不变量，不是一个架构决定**——它架构上有纯 markdown 文件，仍然因为文件写入是
 * 内存库的滞后投影，让用户丢了一个月的日记。
 * 所以这里写完立刻重读、逐个核对 sha256，核不上就**判备份失败**，不给用户一个
 * 「看起来成功了」的文件。
 *
 * ## 为什么不备份模型
 * 模型目录 10 GB 且可重新获取；用户的不可再生数据（库 + 上传的文件）只有约 400 MB。
 * 把可重下的东西塞进备份，会让备份大到没人愿意做——而不做的备份等于没有备份。
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** 备份格式版本。恢复端据此判断自己认不认得这份备份。 */
export const BACKUP_FORMAT_VERSION = 1;

/** 清单里必须登记的条目。 */
export interface BackupEntry {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface BackupManifest {
  readonly formatVersion: number;
  readonly appVersion: string;
  readonly createdAt: string;
  readonly entries: readonly BackupEntry[];
  /**
   * 关键表的行数。**这是给人看的收据**：用户打开清单能看见「我的 37 条对话在里面」，
   * 而不是只看到一个哈希。恢复之后也用它比对。
   */
  readonly rowCounts: Readonly<Record<string, number>>;
  /** 这份备份**没有**包含什么，明说。 */
  readonly excluded: readonly string[];
}

export async function sha256File(path: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest("hex");
}

/** 写一个文件并立刻登记它的大小与摘要。 */
export async function writeEntry(destDir: string, name: string, bytes: Uint8Array): Promise<BackupEntry> {
  const full = join(destDir, name);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, bytes);
  return { path: name, bytes: bytes.byteLength, sha256: await sha256File(full) };
}

/**
 * 重读备份并逐条核对。**这是备份流程的一部分，不是可选的自检**——
 * 核不上就说备份失败，不要交给用户一个看起来成功了的文件。
 */
export async function verifyBackup(destDir: string): Promise<
  { ok: true; manifest: BackupManifest } | { ok: false; reason: string }
> {
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(await readFile(join(destDir, "manifest.json"), "utf8")) as BackupManifest;
  } catch (e) {
    return { ok: false, reason: `读不到清单：${e instanceof Error ? e.message : String(e)}` };
  }
  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    return { ok: false, reason: `备份格式版本是 ${manifest.formatVersion}，这个版本只认得 ${BACKUP_FORMAT_VERSION}` };
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    return { ok: false, reason: "清单里一个文件都没有" };
  }
  for (const e of manifest.entries) {
    const full = join(destDir, e.path);
    let size: number;
    try {
      size = (await stat(full)).size;
    } catch {
      return { ok: false, reason: `清单里有 ${e.path}，但备份里没有这个文件` };
    }
    if (size !== e.bytes) {
      return { ok: false, reason: `${e.path} 大小对不上：清单说 ${e.bytes}，实际 ${size}` };
    }
    if ((await sha256File(full)) !== e.sha256) {
      return { ok: false, reason: `${e.path} 的内容与清单里的摘要对不上` };
    }
  }
  return { ok: true, manifest };
}

/** 备份目录名：带时间戳，避免覆盖上一次备份。**不覆盖**是备份的基本礼貌。 */
export function backupDirName(now: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `workspacex-backup-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

/** 递归收集一个目录下的全部文件（相对路径），空目录不产生条目。 */
export async function collectFiles(root: string, prefix = ""): Promise<readonly string[]> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    const rel = prefix === "" ? name : `${prefix}/${name}`;
    const full = join(root, name);
    const s = await stat(full).catch(() => null);
    if (s === null) continue;
    if (s.isDirectory()) out.push(...(await collectFiles(full, rel)));
    else out.push(rel);
  }
  return out;
}

/**
 * 人话的大小。备份界面要说「约 380 MB」，不要说 398458880。
 */
export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(0)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

/**
 * 收据上要点名的表。**选的是用户认得出来的东西**——他看见「对话 37 条」会知道备份是对的，
 * 看见 `pg_largeobject 12 行` 不会。表不存在时如实记为缺失，不编一个 0 出来。
 */
export const RECEIPT_TABLES = [
  "organizations", "projects", "chat_threads", "chat_messages",
  "artifacts", "agents", "skills", "canvas_templates", "agent_runs",
] as const;

export interface CreateBackupOptions {
  /** 用户选的目标目录；备份会在它下面建一个带时间戳的子目录。 */
  readonly destRoot: string;
  readonly appVersion: string;
  /** 由持有 PGlite 的那一方提供，必须是一致快照（`dumpDataDir`）。 */
  readonly dumpDatabase: () => Promise<Uint8Array>;
  /** 表不存在时返回 null，不要返回 0。 */
  readonly countRows: (table: string) => Promise<number | null>;
  /** 上传的文件所在目录；不存在就当空。 */
  readonly objectsDir: string;
  readonly log?: (line: string) => void;
  readonly now?: Date;
  /**
   * 只为测试留的注入口，默认就是上面那个 `verifyBackup`。
   *
   * 为什么需要它：`createBackup` 写完之后没有任何外部因素会去动那些文件，所以在测试里
   * 校验**永远会通过**——于是「校验失败时必须判备份失败」这条接线没有任何断言打在上面。
   * 实测过：把 `createBackup` 里那句校验整个删掉，13 条测试照样全绿。
   * 校验器自身的正确性由针对真实文件的那组用例保证，这里测的是**接没接上**。
   */
  readonly verify?: (dir: string) => Promise<{ ok: true; manifest: BackupManifest } | { ok: false; reason: string }>;
}

export type CreateBackupResult =
  | { ok: true; dir: string; manifest: BackupManifest; totalBytes: number }
  | { ok: false; reason: string };

export async function createBackup(o: CreateBackupOptions): Promise<CreateBackupResult> {
  const log = o.log ?? (() => {});
  const dir = join(o.destRoot, backupDirName(o.now));
  await mkdir(dir, { recursive: true });

  const entries: BackupEntry[] = [];
  log("[backup] 正在从数据库取一致快照…");
  let dump: Uint8Array;
  try {
    dump = await o.dumpDatabase();
  } catch (e) {
    return { ok: false, reason: `取数据库快照失败：${e instanceof Error ? e.message : String(e)}` };
  }
  entries.push(await writeEntry(dir, "database.tar.gz", dump));
  log(`[backup] 数据库 ${humanBytes(dump.byteLength)}`);

  const objectFiles = await collectFiles(o.objectsDir);
  for (const rel of objectFiles) {
    const bytes = await readFile(join(o.objectsDir, rel));
    entries.push(await writeEntry(dir, `objects/${rel}`, bytes));
  }
  log(`[backup] 上传的文件 ${objectFiles.length} 个`);

  const rowCounts: Record<string, number> = {};
  const missing: string[] = [];
  for (const t of RECEIPT_TABLES) {
    const n = await o.countRows(t).catch(() => null);
    if (n === null) missing.push(t);
    else rowCounts[t] = n;
  }
  if (missing.length > 0) log(`[backup] 这些表不在库里，收据上不列：${missing.join(", ")}`);

  const manifest: BackupManifest = {
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: o.appVersion,
    createdAt: (o.now ?? new Date()).toISOString(),
    entries,
    rowCounts,
    excluded: [
      "本机下载的模型（可重新获取，通常 10 GB 左右）",
      "运行日志",
      "本地账号密码（secrets.json，换机后由新安装重新生成）",
    ],
  };
  await writeFile(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  log("[backup] 正在重读并逐个核对摘要…");
  const v = await (o.verify ?? verifyBackup)(dir);
  if (!v.ok) return { ok: false, reason: `备份写出来了但校验没过：${v.reason}` };

  const totalBytes = entries.reduce((s, e) => s + e.bytes, 0);
  log(`[backup] 完成并校验通过：${dir}（${humanBytes(totalBytes)}）`);
  return { ok: true, dir, manifest, totalBytes };
}
