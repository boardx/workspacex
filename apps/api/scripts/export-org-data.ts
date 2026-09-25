/**
 * 一个组织的**全量数据导出**——开源方案「退出自由」承诺（D11，backlog E5）的落地命令。
 *
 * 承诺原文：客户可以把自己的全部数据用开放格式带走。没有脚本的承诺只是一句话，所以这里是脚本。
 *
 * ## 表是当场发现的，不是手写清单
 *
 * 手写清单写的那天是对的，后来加了表就漏——漏掉的正是「退出自由」要兜住的东西。
 * 所以问 `information_schema.columns`：本库的租户键是 `org_id`（迁移里 1500+ 处，
 * `organizations(id)` 是根），凡有 `org_id` 列的表按 `org_id = $1` 导出；
 * `organizations` 自身按 `id = $1` 导出。**其余每一张表都写进 manifest 的 `skipped`，
 * 带原因**——看不见的缺口比缺口本身更糟。
 *
 * ## 默认不泄漏别的组织
 *
 * 双保险：① 每张表只取 `org_id = $1` 的行（`org_id IS NULL` 的全局行不导出）；
 * ② 整个导出在一个 `REPEATABLE READ READ ONLY` 事务里，并把 `app.current_org`
 * 设成目标组织——RLS（本库 FORCE ROW LEVEL SECURITY）因此也只放行该组织的行。
 *
 * ## 输出（开放格式）
 *
 *   <out>/manifest.json         每张表、行数、文件名；skipped 表及原因；文件清单
 *   <out>/tables/<table>.ndjson 每行一个 JSON 对象；bytea 写成 {"$base64": "..."}
 *   <out>/files.ndjson          所有带 `object_storage_key` 列的行指向的对象存储键
 *
 * 对象存储里的字节本身**不**在本命令里拷贝（它们不在 Postgres），`files.ndjson`
 * 是去对象存储取件的完整清单。加 `--tar` 额外打成 `<out>.tar.gz`。
 *
 * ## 用法
 *
 *   pnpm --filter api exec tsx scripts/export-org-data.ts --org=<organizations.id> --out=<目录> [--tar]
 *
 * 连接用 `migrationConfig()`（与迁移同一身份，同一组 PG* 环境变量）。只读，可重复跑。
 */
import { mkdirSync, createWriteStream, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { migrationConfig } from "../src/infrastructure/db/pg-config";
import { isCliEntry } from "./cli-entry";

const LOG = "[export-org-data]";
export const TENANT_COLUMN = "org_id";
export const ROOT_TABLE = "organizations";
export const FILE_KEY_COLUMN = "object_storage_key";
export const MANIFEST_VERSION = 1;

export interface ColumnRow {
  readonly table: string;
  readonly column: string;
}

export interface IncludedTable {
  readonly table: string;
  /** 过滤列：租户表是 org_id，根表 organizations 是 id。 */
  readonly filterColumn: string;
  readonly hasFileKey: boolean;
}

export interface SkippedTable {
  readonly table: string;
  readonly reason: string;
}

export interface TablePlan {
  readonly included: readonly IncludedTable[];
  readonly skipped: readonly SkippedTable[];
}

/** 迁移账本这类基础设施表：不是任何组织的数据。 */
const INFRA_TABLES: Record<string, string> = {
  _kernel_migrations: "迁移账本（基础设施，不属于任何组织）",
};

/**
 * 纯函数：由 information_schema 的 (table, column) 行决定导出哪些表、跳过哪些表及原因。
 * 每张出现过的表恰好落在 included 或 skipped 之一。
 */
export function planTables(columns: readonly ColumnRow[]): TablePlan {
  const byTable = new Map<string, Set<string>>();
  for (const { table, column } of columns) {
    if (!byTable.has(table)) byTable.set(table, new Set());
    byTable.get(table)!.add(column);
  }
  const included: IncludedTable[] = [];
  const skipped: SkippedTable[] = [];
  for (const table of [...byTable.keys()].sort()) {
    const cols = byTable.get(table)!;
    const hasFileKey = cols.has(FILE_KEY_COLUMN);
    if (table === ROOT_TABLE) {
      included.push({ table, filterColumn: "id", hasFileKey });
    } else if (INFRA_TABLES[table]) {
      skipped.push({ table, reason: INFRA_TABLES[table]! });
    } else if (cols.has(TENANT_COLUMN)) {
      included.push({ table, filterColumn: TENANT_COLUMN, hasFileKey });
    } else {
      skipped.push({ table, reason: `没有 ${TENANT_COLUMN} 列：全局/共享表，或只能经父表关联归属，无法不越界地按组织切分` });
    }
  }
  return { included, skipped };
}

/** 纯函数：一行 → 开放格式 JSON（bytea → base64，Date → ISO 字符串）。 */
export function toJsonRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = toJsonValue(v);
  return out;
}

function toJsonValue(v: unknown): unknown {
  if (Buffer.isBuffer(v)) return { $base64: v.toString("base64") };
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(toJsonValue);
  return v;
}

export interface ExportedTable {
  readonly table: string;
  readonly filterColumn: string;
  readonly rows: number;
  readonly file: string;
}

export interface FileRef {
  readonly table: string;
  readonly id: unknown;
  readonly key: string;
}

export interface Manifest {
  readonly version: number;
  readonly orgId: string;
  readonly exportedAt: string;
  readonly tenantColumn: string;
  readonly tables: readonly ExportedTable[];
  readonly skipped: readonly SkippedTable[];
  readonly files: { readonly file: string; readonly count: number; readonly note: string };
  readonly totals: { readonly tables: number; readonly rows: number; readonly skippedTables: number };
}

/** 纯函数：拼 manifest。表按名排序，确保两次导出可 diff。 */
export function buildManifest(input: {
  orgId: string;
  exportedAt: string;
  tables: readonly ExportedTable[];
  skipped: readonly SkippedTable[];
  fileCount: number;
}): Manifest {
  const tables = [...input.tables].sort((a, b) => a.table.localeCompare(b.table));
  const skipped = [...input.skipped].sort((a, b) => a.table.localeCompare(b.table));
  return {
    version: MANIFEST_VERSION,
    orgId: input.orgId,
    exportedAt: input.exportedAt,
    tenantColumn: TENANT_COLUMN,
    tables,
    skipped,
    files: {
      file: "files.ndjson",
      count: input.fileCount,
      note: `对象存储键清单（来自带 ${FILE_KEY_COLUMN} 列的表）；字节在对象存储里，按键取件`,
    },
    totals: { tables: tables.length, rows: tables.reduce((n, t) => n + t.rows, 0), skippedTables: skipped.length },
  };
}

const quoteIdent = (s: string): string => `"${s.replace(/"/g, '""')}"`;
const BATCH = 2000;

async function writeNdjson(path: string, emit: (write: (line: string) => Promise<void>) => Promise<void>): Promise<void> {
  const ws = createWriteStream(path, { encoding: "utf8" });
  const write = (line: string) =>
    new Promise<void>((res, rej) => (ws.write(line + "\n", (e) => (e ? rej(e) : res()))));
  try {
    await emit(write);
  } finally {
    await new Promise<void>((res) => ws.end(res));
  }
}

/** 导出。调用方负责 client 的连接与关闭。 */
export async function exportOrg(client: pg.Client, orgId: string, outDir: string, now = new Date()): Promise<Manifest> {
  if (existsSync(outDir) && readdirSync(outDir).length > 0) throw new Error(`${LOG} 输出目录非空，拒绝覆盖：${outDir}`);
  mkdirSync(join(outDir, "tables"), { recursive: true });
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await client.query("SELECT set_config('app.current_org', $1, true)", [orgId]);
    const org = await client.query("SELECT 1 FROM organizations WHERE id = $1", [orgId]);
    if (org.rowCount === 0) throw new Error(`${LOG} 组织不存在：${orgId}`);
    const cols = await client.query<{ table: string; column: string }>(
      `SELECT c.table_name AS table, c.column_name AS column
         FROM information_schema.columns c
         JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = current_schema() AND t.table_type = 'BASE TABLE'`,
    );
    const plan = planTables(cols.rows);
    const exported: ExportedTable[] = [];
    const fileRefs: FileRef[] = [];
    for (const t of plan.included) {
      const file = `tables/${t.table}.ndjson`;
      let rows = 0;
      await writeNdjson(join(outDir, file), async (write) => {
        for (let offset = 0; ; offset += BATCH) {
          const r = await client.query(
            `SELECT * FROM ${quoteIdent(t.table)} WHERE ${quoteIdent(t.filterColumn)} = $1 ORDER BY ctid LIMIT ${BATCH} OFFSET ${offset}`,
            [orgId],
          );
          for (const row of r.rows as Record<string, unknown>[]) {
            await write(JSON.stringify(toJsonRow(row)));
            if (t.hasFileKey && typeof row[FILE_KEY_COLUMN] === "string") {
              fileRefs.push({ table: t.table, id: row.id ?? null, key: row[FILE_KEY_COLUMN] as string });
            }
          }
          rows += r.rows.length;
          if (r.rows.length < BATCH) break;
        }
      });
      exported.push({ table: t.table, filterColumn: t.filterColumn, rows, file });
    }
    await writeNdjson(join(outDir, "files.ndjson"), async (write) => {
      for (const f of fileRefs) await write(JSON.stringify(f));
    });
    const manifest = buildManifest({ orgId, exportedAt: now.toISOString(), tables: exported, skipped: plan.skipped, fileCount: fileRefs.length });
    writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    await client.query("COMMIT");
    return manifest;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  }
}

export function parseArgs(argv: readonly string[]): { orgId: string; outDir: string; tar: boolean } {
  const get = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const orgId = get("org");
  const outDir = get("out");
  if (!orgId || !outDir) throw new Error("用法：export-org-data.ts --org=<organizations.id> --out=<目录> [--tar]");
  return { orgId, outDir, tar: argv.includes("--tar") };
}

async function main(): Promise<void> {
  const { orgId, outDir, tar } = parseArgs(process.argv.slice(2));
  const client = new pg.Client(migrationConfig());
  await client.connect();
  try {
    const m = await exportOrg(client, orgId, outDir);
    console.log(`${LOG} org=${orgId} 表 ${m.totals.tables} 张 / 行 ${m.totals.rows} / 跳过 ${m.totals.skippedTables} 张 / 文件键 ${m.files.count} → ${outDir}`);
    if (tar) {
      const archive = `${outDir.replace(/\/+$/, "")}.tar.gz`;
      execFileSync("tar", ["-czf", archive, "-C", dirname(outDir), basename(outDir)]);
      console.log(`${LOG} 打包 → ${archive}`);
    }
  } finally {
    await client.end();
  }
}

if (isCliEntry(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
