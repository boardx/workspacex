/**
 * `pnpm graph:rebuild [--org <orgId>]` —— 从 canonical 表全量重建 AGE 图，并对拍。
 *
 * 什么时候跑：AGE 挂过一段时间刚恢复；怀疑图与 canonical 不一致；投影规则（迁移里的
 * kg_live_vertices / kg_live_edges）改过之后。不带 --org 时重建所有**有本体数据**的 org。
 * 对拍不一致 ⇒ 退出码 1，并打印差异（只有 id 与关系名，没有正文）。
 */
import pg from "pg";
import { migrationConfig } from "../src/infrastructure/db/pg-config";
import { rebuildOrgGraph } from "../src/infrastructure/knowledge-graph/kg-graph-rebuild";

async function main(): Promise<number> {
  const i = process.argv.indexOf("--org");
  const only = i >= 0 ? process.argv[i + 1] : undefined;
  const c = new pg.Client(migrationConfig());
  await c.connect();
  try {
    const orgs = only !== undefined ? [only] : (await c.query<{ org_id: string }>(
      `SELECT org_id FROM ontology_objects WHERE scope_kind IS NOT NULL
       UNION SELECT org_id FROM claims WHERE scope_kind IS NOT NULL
       UNION SELECT org_id FROM ontology_edges WHERE scope_kind IS NOT NULL ORDER BY 1`,
    )).rows.map((r) => r.org_id);
    let bad = 0;
    for (const org of orgs) {
      const r = await rebuildOrgGraph(c, org);
      const ok = r.parity.missingInGraph.length === 0 && r.parity.extraInGraph.length === 0;
      console.log(`${ok ? "✓" : "✗"} ${org}: vertices=${r.vertices} edges=${r.edges}`);
      if (!ok) {
        bad += 1;
        console.log(`  missing in graph: ${r.parity.missingInGraph.join(", ")}`);
        console.log(`  extra in graph:   ${r.parity.extraInGraph.join(", ")}`);
      }
    }
    console.log(`graph:rebuild ${orgs.length} org(s), ${bad} mismatch(es)`);
    return bad === 0 ? 0 : 1;
  } finally {
    await c.end();
  }
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
