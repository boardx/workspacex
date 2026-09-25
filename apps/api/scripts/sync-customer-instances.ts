/**
 * D11 —— 把 D10 车队投影同步成平台组织大脑里的 `customer_instance` 节点 + `running` 边。
 * 映射在 lib/customer-instance-projection.ts（纯函数）；只有不透明实例哈希与运行事实。
 *
 * 来源二选一：
 *   --from-file <fleet.json>   `GET /api/fleet` 的响应体（离线 / 测试）
 *   --url <https://ops-telemetry…>  调 `<url>/api/fleet`，用 Cloudflare Access 服务令牌
 *                              （环境变量 CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET）
 * 幂等：同一车队快照重跑结果相同；已不在车队里的实例节点与边被删掉（projection_source='telemetry'）。
 *
 * 用法：`pnpm --filter api exec tsx scripts/sync-customer-instances.ts (--from-file f | --url u) [--org org-platform] [--dry-run]`
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { isCliEntry } from "./cli-entry";
import { migrationConfig } from "../src/infrastructure/db/pg-config";
import { buildCustomerInstanceProjection, parseFleetInstances } from "./lib/customer-instance-projection";
import { applyProjection } from "./sync-dev-process-projection";
import { applyNodeProjection } from "./import-platform-knowledge";

export async function loadFleet(args: readonly string[]): Promise<unknown> {
  const fileIdx = args.indexOf("--from-file");
  if (fileIdx >= 0) return JSON.parse(readFileSync(args[fileIdx + 1]!, "utf8"));
  const urlIdx = args.indexOf("--url");
  if (urlIdx < 0) throw new Error("need --from-file <fleet.json> or --url <ops-telemetry base url>");
  const id = process.env.CF_ACCESS_CLIENT_ID;
  const secret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (!id || !secret) throw new Error("CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET are required with --url");
  const res = await fetch(new URL("/api/fleet", args[urlIdx + 1]!), {
    headers: { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret },
  });
  if (!res.ok) throw new Error(`GET /api/fleet → ${res.status}`);
  return res.json();
}

export async function syncCustomerInstances(client: pg.Client, orgId: string, fleet: unknown) {
  const { nodes, edges } = buildCustomerInstanceProjection(orgId, parseFleetInstances(fleet));
  const nodeReport = await applyNodeProjection(client, orgId, "telemetry", ["customer_instance"], nodes);
  const edgeReport = await applyProjection(client, orgId, edges, "telemetry");
  return { instances: nodes.length, runningEdges: edges.length, nodes: nodeReport, edges: edgeReport };
}

if (isCliEntry(import.meta.url)) {
  const args = process.argv.slice(2);
  const orgIdx = args.indexOf("--org");
  const orgId = orgIdx >= 0 ? args[orgIdx + 1]! : "org-platform";
  const fleet = await loadFleet(args);
  if (args.includes("--dry-run")) {
    const { nodes, edges } = buildCustomerInstanceProjection(orgId, parseFleetInstances(fleet));
    console.log(JSON.stringify({ orgId, instances: nodes.length, runningEdges: edges.length }, null, 2));
  } else {
    const client = new pg.Client(migrationConfig());
    await client.connect();
    try {
      console.log(JSON.stringify({ orgId, ...(await syncCustomerInstances(client, orgId, fleet)) }, null, 2));
    } finally {
      await client.end();
    }
  }
}
