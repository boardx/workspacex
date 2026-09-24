/**
 * D4 —— 平台大脑 runbook 的**一条命令**（super-instance-design S1；人类决策 D14「既是也不是」：
 * 平台大脑就是跑在一个真实 WorkspaceX 实例上的我们自己的组织）。
 *
 * 立实例本身是运维 / 人类动作；本脚本让「实例立起来之后」的部分可复现、可重跑（全部幂等）：
 *   1. 平台组织：复用 `ensurePlatformOrgSeeded`（与 backfill-platform-org.ts / main.ts 启动自愈同一条路径，
 *      不另写一份建组织的 SQL）。
 *   2. 仓库知识投影（D4）：ADR → decision、.harness/instructions → methodology、mod-* 经验 → lesson。
 *   3. 开发过程投影（D12）：release / PR / defect / feature / evidence 边 + D4 的 decided_by 边。
 *   4. 可选（D11）：`--fleet-file` 或 `--fleet-url` 给了才同步客户实例；不给就跳过，绝不捏造实例。
 *
 * 用法：`pnpm --filter api exec tsx scripts/bootstrap-platform-brain.ts [--fleet-file f | --fleet-url u]`
 * （DATABASE_URL 等连接参数同 migrate：`migrationConfig()`。）
 */
import pg from "pg";
import { isCliEntry } from "./cli-entry";
import { migrationConfig } from "../src/infrastructure/db/pg-config";
import { ensurePlatformOrgSeeded } from "../src/infrastructure/skill/ensure-platform-skill-catalog";
import { PLATFORM_ORG_ID } from "../src/domain/org-id";
import { buildKnowledgeNodes } from "./lib/knowledge-projection";
import { applyNodeProjection, KNOWLEDGE_KINDS, readRepoDocs } from "./import-platform-knowledge";
import { applyProjection, buildRepoEdgeSet } from "./sync-dev-process-projection";
import { loadFleet, syncCustomerInstances } from "./sync-customer-instances";

if (isCliEntry(import.meta.url)) {
  const args = process.argv.slice(2);
  const orgId = PLATFORM_ORG_ID;
  const org = await ensurePlatformOrgSeeded();
  const client = new pg.Client(migrationConfig());
  await client.connect();
  try {
    const knowledge = await applyNodeProjection(
      client, orgId, "repo", KNOWLEDGE_KINDS, buildKnowledgeNodes(orgId, readRepoDocs()),
    );
    const devProcess = await applyProjection(client, orgId, buildRepoEdgeSet(orgId), "repo");
    const fleetArgs = args.includes("--fleet-file")
      ? ["--from-file", args[args.indexOf("--fleet-file") + 1]!]
      : args.includes("--fleet-url")
        ? ["--url", args[args.indexOf("--fleet-url") + 1]!]
        : null;
    const customers = fleetArgs ? await syncCustomerInstances(client, orgId, await loadFleet(fleetArgs)) : "skipped (no fleet source)";
    console.log(JSON.stringify({ orgId, org, knowledge, devProcess, customers }, null, 2));
  } finally {
    await client.end();
  }
}
