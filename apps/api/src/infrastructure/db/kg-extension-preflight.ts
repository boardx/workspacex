/**
 * #4366（人类决定 2026-09）：`age` / `vector` 两个扩展的最低版本预检——**迁移之前**跑，版本不够就明说、拒绝继续。
 *
 * 最低版本只在这里声明（vector 的数字从召回侧的常量派生）：
 *   - `vector` ≥ 0.8.0（数字取自 hnsw-ann.ts 的 ITERATIVE_SCAN_SINCE）：召回的向量通道按 HNSW + 迭代扫描设计（`hnsw.iterative_scan`，0.8.0 引入，见 `hnsw-ann.ts`），
 *     低于它时权限过滤后取不满 k 条要靠精确扫描补全，大租户上延迟不可控。阿里云 RDS PG16 当前提供 0.8.0。
 *   - `age` ≥ 1.6.0：本仓的 AGE 镜像（`apps/api/docker/postgres-age`，PG16/v1.6.0-rc0 提交）与阿里云 RDS PG16
 *     （AliPG 内核小版本 ≥ 20251130）提供的版本；更旧的实例（20240830 带的是 1.5.0）须先升级内核小版本。
 * 只依赖这两个版本已有的能力，不用更新版本的特性。
 *
 * 看的是 `pg_available_extensions`：已装的看 `installed_version`，没装的看 `default_version`（CREATE EXTENSION 会装的那个）。
 */
import { ITERATIVE_SCAN_SINCE } from "../retrieval/hnsw-ann";

/** vector 的最低版本不另写数字：就是召回侧开迭代扫描要求的那个版本（hnsw-ann.ts，0.8.0）。 */
export const KG_EXTENSION_MINIMUMS = { vector: ITERATIVE_SCAN_SINCE.join("."), age: "1.6.0" } as const;
export type KgExtension = keyof typeof KG_EXTENSION_MINIMUMS;

export interface AvailableExtensionRow {
  readonly name: string;
  readonly default_version: string | null;
  readonly installed_version: string | null;
}

export interface ExtensionFinding {
  readonly name: KgExtension;
  readonly required: string;
  /** 实际会用到的版本；null ⇒ 这个实例上根本没有这个扩展。 */
  readonly found: string | null;
  readonly ok: boolean;
}

/** 预检用的 SQL（任何角色都能读 pg_available_extensions）。 */
export const KG_EXTENSION_PREFLIGHT_SQL =
  "SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name IN ('age', 'vector') ORDER BY name";

/** 点分版本号比较：`have` ≥ `want`？非数字段（如 `1.6.0-rc0` 里的 `0-rc0` 取前导数字）按数字前缀比。 */
export function versionAtLeast(have: string, want: string): boolean {
  const num = (v: string) => v.split(".").map((p) => Number.parseInt(p, 10));
  const h = num(have), w = num(want);
  for (let i = 0; i < w.length; i++) {
    const a = h[i] ?? 0, b = w[i]!;
    if (Number.isNaN(a)) return false;
    if (a !== b) return a > b;
  }
  return true;
}

export function checkKgExtensions(rows: readonly AvailableExtensionRow[]): readonly ExtensionFinding[] {
  return (Object.keys(KG_EXTENSION_MINIMUMS) as KgExtension[]).sort().map((name) => {
    const row = rows.find((r) => r.name === name);
    const found = row?.installed_version ?? row?.default_version ?? null;
    const required = KG_EXTENSION_MINIMUMS[name];
    const ok = found !== null && versionAtLeast(found, required);
    return { name, required, found, ok };
  });
}

/** 给运维看的一段话：每个不达标的扩展一行，说清要多少、现在是多少、该怎么办。全部达标 ⇒ null。 */
export function explainKgExtensionFindings(findings: readonly ExtensionFinding[]): string | null {
  const bad = findings.filter((f) => !f.ok);
  if (bad.length === 0) return null;
  return bad.map((f) => f.found === null
    ? `extension "${f.name}" is not available on this PostgreSQL instance (required >= ${f.required}); on Aliyun RDS PostgreSQL 16 upgrade the AliPG minor kernel first`
    : `extension "${f.name}" ${f.found} is below the required ${f.required}; on Aliyun RDS PostgreSQL 16 upgrade the AliPG minor kernel (age 1.6.0 needs >= 20251130) before migrating`).join("\n");
}
