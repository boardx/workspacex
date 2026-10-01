/**
 * Phase 18 F04 —— 按 org 全量重建 AGE 图，并与 canonical 逐行对拍。
 *
 * 用迁移角色的连接（重建要 drop / create 图，app_rw 没有这个权限，也不该有）。
 * `pnpm graph:rebuild` 与对拍测试共用这里，不存在第二份对拍逻辑。
 */
import type pg from "pg";

export interface GraphParity {
  /** canonical 里有、图里没有（按多重集：canonical 比图多出的每一次出现） */
  readonly missingInGraph: readonly string[];
  /** 图里有、canonical 里没有（按多重集：重复边的每个多余副本各列一次） */
  readonly extraInGraph: readonly string[];
}

/** 调用方负责事务；本函数只在当前事务里设 org。 */
export async function graphParity(c: pg.ClientBase, orgId: string): Promise<GraphParity> {
  await c.query("SELECT set_config('app.current_org', $1, true)", [orgId]);
  const q = (sql: string) => c.query<{ x: string }>(sql).then((r) => r.rows.map((row) => row.x).sort());
  const canonical = await q("SELECT x FROM kg_canonical_snapshot() AS x");
  const graph = await q("SELECT x FROM kg_graph_snapshot() AS x");
  // 按多重集比（#4270）：图里同一条边出现两次也是不一致。按 Set 比时两条一模一样的边算一条，重复边因此一直没被发现。
  return { missingInGraph: multisetMinus(canonical, graph), extraInGraph: multisetMinus(graph, canonical) };
}

/** a − b（多重集）：a 里比 b 多出来的每一次出现都列出来。 */
function multisetMinus(a: readonly string[], b: readonly string[]): string[] {
  const left = new Map<string, number>();
  for (const x of b) left.set(x, (left.get(x) ?? 0) + 1);
  return a.filter((x) => {
    const n = left.get(x) ?? 0;
    if (n === 0) return true;
    left.set(x, n - 1);
    return false;
  });
}

export interface RebuildResult {
  readonly orgId: string;
  readonly vertices: number;
  readonly edges: number;
  readonly parity: GraphParity;
}

export async function rebuildOrgGraph(c: pg.ClientBase, orgId: string): Promise<RebuildResult> {
  // 重建与对拍在同一个 REPEATABLE READ 事务里：两边读的是同一个 canonical 快照，并发写入不会让对拍报出假的不一致。
  // ⚠ 快照必须在拿到图锁**之后**才建：否则「快照之后提交的变动」可能被 worker 在我们拿锁之前投影并删掉 outbox 行，
  //   随后我们 drop 图、按旧快照重建——那次变动就永久丢了，而对拍在同一快照里还报一致。
  //   所以先在事务外拿会话级 advisory lock（与 worker 的事务级锁同一个键，互斥），再开事务。
  const lockKey = "SELECT hashtext('kg_graph:' || kg_org_graph_name($1)) AS k";
  const key = (await c.query<{ k: number }>(lockKey, [orgId])).rows[0]!.k;
  await c.query("SELECT pg_advisory_lock($1)", [key]);
  try {
    return await rebuildLocked(c, orgId);
  } finally {
    await c.query("SELECT pg_advisory_unlock($1)", [key]);
  }
}

async function rebuildLocked(c: pg.ClientBase, orgId: string): Promise<RebuildResult> {
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
