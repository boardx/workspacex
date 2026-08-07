import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Args } from "./lib/args";
import { compileRepositoryGraph } from "./lib/graph-compiler";
import { loadGraphRegistry } from "./lib/graph-registry";
import { serializeGraphSnapshot, stableJson } from "./lib/graph-stable";
import { validateGraph } from "./lib/graph-validator";
import { REPO_ROOT } from "./lib/paths";
import { log } from "./lib/log";

export const GRAPH_CACHE_DIR = join(REPO_ROOT, ".harness", "state", ".cache", "graph");

function writeGraphOutputs(snapshotText: string, findings: unknown): void {
  mkdirSync(GRAPH_CACHE_DIR, { recursive: true });
  writeFileSync(join(GRAPH_CACHE_DIR, "current.snapshot.json"), snapshotText, "utf8");
  writeFileSync(join(GRAPH_CACHE_DIR, "current.findings.json"), stableJson(findings), "utf8");
}

export function graphCommand(args: Args): void {
  const action = args._[0];
  if (action !== "compile" && action !== "validate") {
    throw new Error("用法: pnpm harness graph <compile|validate> [--no-cache]");
  }
  const snapshot = compileRepositoryGraph(REPO_ROOT);
  const snapshotText = serializeGraphSnapshot(snapshot);
  const findings = validateGraph(snapshot, loadGraphRegistry(REPO_ROOT));
  if (!args.flags["no-cache"]) writeGraphOutputs(snapshotText, findings);

  log.info(
    `[graph] schema=${snapshot.graph_schema_version} revision=${snapshot.source_revision.slice(0, 12)} ` +
      `nodes=${snapshot.nodes.length} edges=${snapshot.edges.length} fingerprint=${snapshot.fingerprint}`
  );
  if (action === "compile") {
    log.ok(args.flags["no-cache"] ? "Graph Snapshot 编译完成（未写缓存）" : `Graph Snapshot 已写入 ${GRAPH_CACHE_DIR}`);
    return;
  }
  if (findings.length > 0) {
    for (const item of findings) {
      log.err(`${item.constraint_id} ${item.focus_node} ${item.path}: ${item.message}`);
    }
    throw new Error(`Graph validation FAIL: ${findings.length} finding(s)`);
  }
  log.ok("Graph validation PASS");
}
