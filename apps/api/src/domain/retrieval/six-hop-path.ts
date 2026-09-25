/**
 * D11 —— 六跳路径检索的纯函数（docs/research/super-instance-design.md §2 / S5）：
 *
 *   客户实例 ─running→ 发布 ─contains→ PR ─fixes→ 缺陷
 *                                        PR ─decided_by→ 决策
 *                                        PR ─verified_by→ 证据
 *
 * 前三跳是链；决策与证据挂在同一个 PR 上（D12 / D4 的投影边就是这么出的）。
 * 某一跳图里没有时对应字段是 null，不丢整条路径——「图里缺哪一跳」本身就是答案的一部分。
 * 结果契约：packages/contracts/src/ontology-projection.ts 的 SixHopPath。
 */
import type { ontologyProjection } from "@repo/contracts";

export interface GraphEdge {
  src_kind: string;
  src_id: string;
  relation: string;
  dst_kind: string;
  dst_id: string;
}

export const SIX_HOP_RELATIONS = ["running", "contains", "fixes", "decided_by", "verified_by"] as const;

export function walkSixHops(instanceId: string, edges: readonly GraphEdge[]): ontologyProjection.SixHopPath[] {
  const out = (srcKind: string, srcId: string, relation: string, dstKind: string) =>
    [...new Set(
      edges
        .filter((e) => e.src_kind === srcKind && e.src_id === srcId && e.relation === relation && e.dst_kind === dstKind)
        .map((e) => e.dst_id),
    )].sort();
  const orNull = (xs: string[]) => (xs.length ? xs : [null]);

  const paths: ontologyProjection.SixHopPath[] = [];
  for (const release of out("customer_instance", instanceId, "running", "release")) {
    for (const pullRequest of out("release", release, "contains", "pull_request")) {
      const decisions = orNull(out("pull_request", pullRequest, "decided_by", "decision"));
      const evidence = orNull(out("pull_request", pullRequest, "verified_by", "evidence"));
      for (const defect of orNull(out("pull_request", pullRequest, "fixes", "defect"))) {
        for (const decision of decisions) {
          for (const ev of evidence) {
            paths.push({ customerInstance: instanceId, release, pullRequest, defect, decision, evidence: ev });
          }
        }
      }
    }
  }
  return paths;
}
