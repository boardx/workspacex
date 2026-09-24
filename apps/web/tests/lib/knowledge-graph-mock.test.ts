import { describe, it, expect } from "vitest";
import {
  groupClaimsByKind,
  countByTriState,
  threadKnowledgeNormal,
  KG_CLAIM_KIND_LABEL_ZH,
} from "@/lib/mock/knowledge-graph";
import { claimTriState, KG_TRI_STATE_LABEL_ZH } from "@repo/contracts/knowledge-graph";
import type { KgClaim } from "@repo/contracts/knowledge-graph";

/**
 * 守护知识面板的两个纯投影函数：分组 + 三态计数。
 * 重点：`superseded`（triState=null）不渲染；映射走契约单源，不另建表。
 */

function fakeClaim(id: string, kind: KgClaim["kind"], status: KgClaim["status"]): KgClaim {
  return {
    id, scope: { kind: "chat_session", id: "t" }, kind, statement: `s-${id}`,
    status, triState: claimTriState(status) ?? "pending", confidence: 0.5, createdBy: "model",
    reviewedBy: null, supersedesClaimId: null, derivedFromClaimId: null, aboutObjectIds: [],
    supportingCount: 1, contradictingCount: 0, createdAt: "2026-09-23T00:00:00Z",
  };
}

describe("groupClaimsByKind", () => {
  it("按 kind 分组且丢弃 superseded", () => {
    const claims = [
      fakeClaim("a", "decision", "accepted"),
      fakeClaim("b", "decision", "proposed"),
      fakeClaim("c", "fact", "superseded"), // 应被丢弃
      fakeClaim("d", "risk", "contested"),
    ];
    const groups = groupClaimsByKind(claims);
    const byKind = Object.fromEntries(groups.map((g) => [g.kind, g.claims.length]));
    expect(byKind.decision).toBe(2);
    expect(byKind.fact).toBeUndefined(); // 唯一的 fact 是 superseded → 整组消失
    expect(byKind.risk).toBe(1);
    expect(groups.every((g) => g.label === KG_CLAIM_KIND_LABEL_ZH[g.kind])).toBe(true);
  });

  it("mock 数据里含冲突对，且三态标签取自契约单源", () => {
    const counts = countByTriState(threadKnowledgeNormal.claims);
    expect(counts.conflict).toBeGreaterThanOrEqual(2);
    expect(counts.confirmed).toBeGreaterThan(0);
    expect(counts.pending).toBeGreaterThan(0);
    expect(KG_TRI_STATE_LABEL_ZH.conflict).toBe("冲突");
  });
});
