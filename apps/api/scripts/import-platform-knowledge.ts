/**
 * D4 —— 把仓库里的 ADR / 方法论 / 模块经验导入平台组织大脑的 `ontology_nodes`，作为**投影**
 * （人类决策 D17 读法 B：仓库权威，产品只读，可重建）。映射在 lib/knowledge-projection.ts（纯函数）。
 *
 * 幂等：行 id 由 (org, kind, key) 哈希确定，正文不变则不写；仓库里已消失的节点被删掉。
 * 与 D12 的边一样只能在 `workspacex.projection_sync = on` 的事务里写（迁移 20260924240000 的触发器）。
 *
 * 用法：`pnpm --filter api exec tsx scripts/import-platform-knowledge.ts [--org org-platform] [--dry-run]`
 * 常规入口是一条命令的 runbook：scripts/bootstrap-platform-brain.ts。
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { isCliEntry } from "./cli-entry";
import { migrationConfig } from "../src/infrastructure/db/pg-config";
import { buildKnowledgeNodes, type RepoDoc } from "./lib/knowledge-projection";
import type { ontologyProjection } from "@repo/contracts";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function walkMd(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkMd(p));
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
}

export function readRepoDocs(root = REPO_ROOT): RepoDoc[] {
  const files = [
    ...walkMd(join(root, "docs", "adr")),
    ...walkMd(join(root, ".harness", "instructions")),
    ...readdirSync(join(root, ".agents", "skills"))
      .filter((d) => d.startsWith("mod-"))
      .map((d) => join(root, ".agents", "skills", d, "SKILL.md"))
      .filter((p) => existsSync(p)),
  ];
  return files.sort().map((abs) => ({ path: relative(root, abs).split(sep).join("/"), content: readFileSync(abs, "utf8") }));
}

/** 按 projection_source + kinds 整体替换一批投影节点。 */
export async function applyNodeProjection(
  client: pg.Client,
  orgId: string,
  source: ontologyProjection.ProjectionSource,
  kinds: readonly ontologyProjection.OntologyNodeKind[],
  nodes: readonly ontologyProjection.ProjectionNode[],
): Promise<{ written: number; removed: number }> {
  if (nodes.some((n) => n.projectionSource !== source || !kinds.includes(n.kind))) {
    throw new Error("node set outside the declared projection scope");
  }
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('workspacex.projection_sync', 'on', true)");
    await client.query("SELECT set_config('app.current_org', $1, true)", [orgId]);
    let written = 0;
    for (const n of nodes) {
      const r = await client.query(
        `INSERT INTO ontology_nodes (id, org_id, kind, node_key, title, body, source_path, content_hash, projection_source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE
           SET title = EXCLUDED.title, body = EXCLUDED.body, source_path = EXCLUDED.source_path,
               content_hash = EXCLUDED.content_hash
         WHERE ontology_nodes.content_hash IS DISTINCT FROM EXCLUDED.content_hash`,
        [n.id, orgId, n.kind, n.key, n.title, n.body, n.sourcePath, n.contentHash, n.projectionSource],
      );
      written += r.rowCount ?? 0;
    }
    const removed = await client.query(
      `DELETE FROM ontology_nodes
        WHERE org_id = $1 AND projection_source = $2 AND kind = ANY($3::text[]) AND NOT (id = ANY($4::text[]))`,
      [orgId, source, [...kinds], nodes.map((n) => n.id)],
    );
    await client.query("COMMIT");
    return { written, removed: removed.rowCount ?? 0 };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

export const KNOWLEDGE_KINDS = ["decision", "methodology", "lesson"] as const;

if (isCliEntry(import.meta.url)) {
  const args = process.argv.slice(2);
  const orgIdx = args.indexOf("--org");
  const orgId = orgIdx >= 0 ? args[orgIdx + 1]! : "org-platform";
  const nodes = buildKnowledgeNodes(orgId, readRepoDocs());
  const byKind: Record<string, number> = {};
  for (const n of nodes) byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
  if (args.includes("--dry-run")) {
    console.log(JSON.stringify({ orgId, nodes: nodes.length, byKind }, null, 2));
  } else {
    const client = new pg.Client(migrationConfig());
    await client.connect();
    try {
      const report = await applyNodeProjection(client, orgId, "repo", KNOWLEDGE_KINDS, nodes);
      console.log(JSON.stringify({ orgId, nodes: nodes.length, byKind, ...report }, null, 2));
    } finally {
      await client.end();
    }
  }
}
