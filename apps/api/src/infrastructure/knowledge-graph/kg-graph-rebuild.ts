/**
 * Phase 18 F04 —— 按 org 全量重建 AGE 图，并与 canonical 逐行对拍。
 *
 * 用迁移角色的连接（重建要 drop / create 图，app_rw 没有这个权限，也不该有）。
 * `pnpm graph:rebuild` 与对拍测试共用这里，不存在第二份对拍逻辑。
 */
import type pg from "pg";

export interface GraphParity {
  /** canonical 里有、图里没有 */
  readonly missingInGraph: readonly string[];
  /** 图里有、canonical 里没有 */
  readonly extraInGraph: readonly string[];
}

/** 调用方负责事务；本函数只在当前事务里设 org。 */
export async function graphParity(c: pg.ClientBase, orgId: string): Promise<GraphParity> {
  await c.query("SELECT set_config('app.current_org', $1, true)", [orgId]);
  const q = (sql: string) => c.query<{ x: string }>(sql).then((r) => r.rows.map((row) => row.x).sort());
  const canonical = await q("SELECT x FROM kg_canonical_snapshot() AS x");
  const graph = await q("SELECT x FROM kg_graph_snapshot() AS x");
  const g = new Set(graph);
  const cset = new Set(canonical);
  return { missingInGraph: canonical.filter((x) => !g.has(x)), extraInGraph: graph.filter((x) => !cset.has(x)) };
}

export interface RebuildResult {
  readonly orgId: string;
  readonly vertices: number;
  readonly edges: number;
  readonly parity: GraphParity;
}

export async function rebuildOrgGraph(c: pg.ClientBase, orgId: string): Promise<RebuildResult> {
  // 重建与对拍在同一个 REPEATABLE READ 事务里：两边读的是同一个 canonical 快照，
  // 并发写入不会让对拍报出假的不一致。
  await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  try {
    await c.query("SELECT set_config('app.current_org', $1, true)", [orgId]);
    const r = await c.query<{ r: { vertices: number; edges: number } }>("SELECT kg_rebuild_current_org_graph() AS r");
    const parity = await graphParity(c, orgId);
    await c.query("COMMIT");
    return { orgId, vertices: r.rows[0]!.r.vertices, edges: r.rows[0]!.r.edges, parity };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  }
}
