/**
 * D12 —— 把平台大脑「开发过程」那一半同步为产品组织大脑里的**投影**（人类决策 D17 读法 B）。
 *
 * 权威源永远是仓库：git tag（发布）、squash 提交标题的 `(#N)`（PR）、fix 提交正文的
 * `Closes/Fixes #N`（缺陷）、`phases/<phase>/feature_list.json`（feature → 证据）。
 * 本脚本幂等：同一仓库状态重跑结果相同（边 id 由内容哈希确定）；仓库里已消失的边会被删掉
 * （投影可重建，不累积）。写入的行 `projection_source = 'repo'`，对产品只读（迁移触发器）。
 *
 * 用法：`pnpm --filter api exec tsx scripts/sync-dev-process-projection.ts [--org org-platform] [--dry-run]`
 */
import { execFileSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { isCliEntry } from "./cli-entry";
import { migrationConfig } from "../src/infrastructure/db/pg-config";
import { loadFeatureListIn } from "../../../.harness/scripts/lib/features";
import {
  buildProjectionEdges,
  parseCommitLog,
  type FeatureRecord,
  type ReleaseRange,
  type RepoSnapshot,
} from "./lib/dev-process-projection";
import type { ontologyProjection } from "@repo/contracts";
import { buildDecisionEdges, buildKnowledgeNodes } from "./lib/knowledge-projection";
import { readRepoDocs } from "./import-platform-knowledge";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function git(args: string[]): string {
  return execFileSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

export function readRepoSnapshot(): RepoSnapshot {
  const commits = parseCommitLog(git(["log", "--format=%H%x1f%s%x1f%b%x1e"]));
  const tags = git(["tag", "--sort=creatordate"]).split("\n").map((t) => t.trim()).filter(Boolean);
  const releases: ReleaseRange[] = tags.map((tag, i) => {
    const range = i === 0 ? tag : `${tags[i - 1]}..${tag}`;
    return { tag, commitShas: git(["rev-list", range]).split("\n").filter(Boolean) };
  });
  const features: FeatureRecord[] = [];
  const phasesDir = join(REPO_ROOT, "phases");
  for (const phase of readdirSync(phasesDir, { withFileTypes: true })) {
    if (!phase.isDirectory() || !existsSync(join(phasesDir, phase.name, "feature_list.json"))) continue;
    for (const f of loadFeatureListIn(join(phasesDir, phase.name)).features) {
      features.push({ phase: phase.name, id: f.id, status: f.status, evidence: String(f.evidence ?? "") });
    }
  }
  return { commits, releases, features };
}

/**
 * 仓库权威的全部投影边：D12 开发过程边 + D4 的 `pull_request -decided_by-> decision`。
 * 两者同属 projection_source = 'repo'，必须作为一整套一起替换，否则一方会删掉另一方。
 */
export function buildRepoEdgeSet(orgId: string, snap = readRepoSnapshot()): ontologyProjection.ProjectionEdge[] {
  const decisions = new Set(
    buildKnowledgeNodes(orgId, readRepoDocs()).filter((n) => n.kind === "decision").map((n) => n.key),
  );
  const all = [...buildProjectionEdges(orgId, snap), ...buildDecisionEdges(orgId, snap.commits, decisions)];
  return [...new Map(all.map((e) => [e.id, e])).values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function applyProjection(
  client: pg.Client,
  orgId: string,
  edges: readonly ontologyProjection.ProjectionEdge[],
  source: ontologyProjection.ProjectionSource = "repo",
): Promise<{ upserted: number; removed: number }> {
  if (edges.some((e) => e.projectionSource !== source)) throw new Error(`edge set mixes projection sources (expected ${source})`);
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('workspacex.projection_sync', 'on', true)");
    await client.query("SELECT set_config('app.current_org', $1, true)", [orgId]);
    let upserted = 0;
    for (const e of edges) {
      const r = await client.query(
        `INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, projection_source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [e.id, orgId, e.src.kind, e.src.id, e.dst.kind, e.dst.id, e.relation, e.projectionSource],
      );
      upserted += r.rowCount ?? 0;
    }
    const removed = await client.query(
      `DELETE FROM ontology_edges
        WHERE org_id = $1 AND projection_source = $3 AND NOT (id = ANY($2::text[]))`,
      [orgId, edges.map((e) => e.id), source],
    );
    await client.query("COMMIT");
    return { upserted, removed: removed.rowCount ?? 0 };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

if (isCliEntry(import.meta.url)) {
  const args = process.argv.slice(2);
  const orgIdx = args.indexOf("--org");
  const orgId = orgIdx >= 0 ? args[orgIdx + 1]! : "org-platform";
  const edges = buildRepoEdgeSet(orgId);
  const byRelation: Record<string, number> = {};
  for (const e of edges) byRelation[e.relation] = (byRelation[e.relation] ?? 0) + 1;
  if (args.includes("--dry-run")) {
    console.log(JSON.stringify({ orgId, edges: edges.length, byRelation }, null, 2));
  } else {
    const client = new pg.Client(migrationConfig());
    await client.connect();
    try {
      const report = await applyProjection(client, orgId, edges);
      console.log(JSON.stringify({ orgId, edges: edges.length, byRelation, ...report }, null, 2));
    } finally {
      await client.end();
    }
  }
}
