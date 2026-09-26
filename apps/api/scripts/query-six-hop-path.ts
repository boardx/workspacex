/**
 * D11 —— 从一个客户实例哈希出发走六跳路径（纯走法见 src/domain/retrieval/six-hop-path.ts）。
 *
 * 递归 CTE 只把「从该实例可达的六跳相关边」取出来（同 pg-segment-retriever 的图通道：不用 AGE），
 * 然后交给纯函数拼路径。
 *
 * 为什么在 scripts/ 而不在 src/infrastructure/：平台大脑目前只有运维读者（平台组织），没有产品
 * 端的披露面；放进 src/ 就是一条不经 permission-filter 的租户读（lint-permission-paths 会红，且理应红）。
 * 哪天要在产品里给组织成员看，必须在那一层接上判权，再搬过去。
 *
 * 用法：`pnpm --filter api exec tsx scripts/query-six-hop-path.ts <instance-hash> [--org org-platform]`
 */
import pg from "pg";
import { isCliEntry } from "./cli-entry";
import { migrationConfig } from "../src/infrastructure/db/pg-config";
import { SIX_HOP_RELATIONS, walkSixHops, type GraphEdge } from "../src/domain/retrieval/six-hop-path";

export const SIX_HOP_SQL = `
WITH RECURSIVE reach(kind, id, depth) AS (
  SELECT 'customer_instance'::text, $2::text, 0
  UNION
  SELECT e.dst_kind, e.dst_id, r.depth + 1
    FROM reach r
    JOIN ontology_edges e
      ON e.org_id = $1 AND e.src_kind = r.kind AND e.src_id = r.id AND e.relation = ANY($3::text[])
   WHERE r.depth < 3
)
SELECT DISTINCT e.src_kind, e.src_id, e.relation, e.dst_kind, e.dst_id
  FROM ontology_edges e
  JOIN reach r ON e.src_kind = r.kind AND e.src_id = r.id
 WHERE e.org_id = $1 AND e.relation = ANY($3::text[])`;

/** client 需已在该组织的租户上下文里（`app.current_org`），RLS 兜底，SQL 里显式 org_id 双保险。 */
export async function findSixHopPaths(client: Pick<pg.Client, "query">, orgId: string, instanceId: string) {
  const r = await client.query<GraphEdge>(SIX_HOP_SQL, [orgId, instanceId, [...SIX_HOP_RELATIONS]]);
  return walkSixHops(instanceId, r.rows);
}

if (isCliEntry(import.meta.url)) {
  const args = process.argv.slice(2);
  const orgIdx = args.indexOf("--org");
  const orgId = orgIdx >= 0 ? args[orgIdx + 1]! : "org-platform";
  const instanceId = args.find((a) => /^[0-9a-f]{64}$/.test(a));
  if (!instanceId) throw new Error("usage: query-six-hop-path.ts <64-hex instance id> [--org org-platform]");
  const client = new pg.Client(migrationConfig());
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_org', $1, true)", [orgId]);
    console.log(JSON.stringify(await findSixHopPaths(client, orgId, instanceId), null, 2));
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
}
