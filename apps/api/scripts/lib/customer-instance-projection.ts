/**
 * D11 —— 把 D10 车队投影（apps/ops-telemetry `GET /api/fleet` 的 `instances[]`）映射成平台组织
 * 大脑里的 `customer_instance` 节点 + `running` 边（实例 → 发布）。纯函数，无 IO。
 *
 * 只有不透明实例哈希（契约 InstanceId：64 位十六进制）与运行事实（版次 / 版本 / 健康分档 /
 * 上报期末）。不接受、不存任何客户内容：只挑白名单字段，不合契约形状的实例行直接丢掉。
 * 权威在 D10 边缘投影，所以 projection_source = 'telemetry'，对产品只读。
 */
import { z } from "zod";
import type { ontologyProjection } from "@repo/contracts";
import { edgeId } from "./dev-process-projection";
import { makeNode } from "./knowledge-projection";

type ProjectionNode = ontologyProjection.ProjectionNode;
type ProjectionEdge = ontologyProjection.ProjectionEdge;

/** 只取需要的字段——zod 默认 strip，多出来的键不会被带进图。 */
export const FleetInstanceRow = z.object({
  instanceId: z.string().regex(/^[0-9a-f]{64}$/),
  edition: z.string().min(1).max(32),
  productVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  health: z.enum(["healthy", "degraded", "down", "unreported"]),
  periodEnd: z.string().max(40),
});
export type FleetInstanceRow = z.infer<typeof FleetInstanceRow>;

/** 发布节点 id 与 D12 一致：git tag `v<semver>`。 */
export const releaseIdForVersion = (v: string) => `v${v}`;

export function parseFleetInstances(fleetJson: unknown): FleetInstanceRow[] {
  const rows = (fleetJson as { instances?: unknown } | null)?.instances;
  if (!Array.isArray(rows)) throw new Error("fleet projection has no instances[]");
  const out: FleetInstanceRow[] = [];
  for (const r of rows) {
    const p = FleetInstanceRow.safeParse(r);
    if (p.success) out.push(p.data);
  }
  return out;
}

export function buildCustomerInstanceProjection(
  orgId: string,
  rows: readonly FleetInstanceRow[],
): { nodes: ProjectionNode[]; edges: ProjectionEdge[] } {
  const nodes = new Map<string, ProjectionNode>();
  const edges = new Map<string, ProjectionEdge>();
  for (const r of rows) {
    const facts = { edition: r.edition, productVersion: r.productVersion, health: r.health, periodEnd: r.periodEnd };
    const n = makeNode(orgId, "customer_instance", r.instanceId, `instance ${r.instanceId.slice(0, 12)}`,
      JSON.stringify(facts), null, "telemetry");
    nodes.set(n.id, n);
    const src = { kind: "customer_instance" as const, id: r.instanceId };
    const dst = { kind: "release" as const, id: releaseIdForVersion(r.productVersion) };
    const id = edgeId(orgId, src, "running", dst);
    edges.set(id, { id, src, dst, relation: "running", projectionSource: "telemetry" });
  }
  const sorted = <T extends { id: string }>(m: Map<string, T>) => [...m.values()].sort((a, b) => a.id.localeCompare(b.id));
  return { nodes: sorted(nodes), edges: sorted(edges) };
}
