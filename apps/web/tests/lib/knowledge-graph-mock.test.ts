import { describe, it, expect } from "vitest";
import {
  groupClaimsByKind,
  countByTriState,
  threadKnowledgeNormal,
  threadKnowledgeReadOnly,
  KG_CLAIM_KIND_LABEL_ZH,
  KG_OBJECT_KIND_LABEL_ZH,
  KG_VISIBILITY_LABEL_ZH,
  KG_RELATED_QUERY_DEGRADED_ZH,
  RETRIEVAL_CHANNEL_LABEL_ZH,
  KG_BANNED_USER_FACING_WORDS,
  relatedQueryDegraded,
  channelHealthGraphDown,
  channelHealthVectorDown,
  channelHealthAllOk,
  promotionResultsMixed,
} from "@/lib/mock/knowledge-graph";
import { claimTriState, KG_TRI_STATE_LABEL_ZH } from "@repo/contracts/chat-knowledge-graph";
import type { KgClaim } from "@repo/contracts/chat-knowledge-graph";

/**
 * 守护记忆面板的纯投影函数 + 「说人话」用词表（06-user-experience.md 第五节 / E6）。
 * 重点：`superseded`（triState=null）不渲染；映射走契约单源；界面文案不含内部术语。
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

  it("mock 数据里含矛盾对，且三态标签取自契约单源（说人话）", () => {
    const counts = countByTriState(threadKnowledgeNormal.claims);
    expect(counts.conflict).toBeGreaterThanOrEqual(2);
    expect(counts.confirmed).toBeGreaterThan(0);
    expect(counts.pending).toBeGreaterThan(0);
    // U-1…U-6 用词：界面上说「有矛盾 / AI 记下的 / 你确认过」，不是「冲突 / 待确认」
    expect(KG_TRI_STATE_LABEL_ZH.conflict).toBe("有矛盾");
    expect(KG_TRI_STATE_LABEL_ZH.pending).toBe("AI 记下的");
    expect(KG_TRI_STATE_LABEL_ZH.confirmed).toBe("你确认过");
  });
});

describe("U-6 可见范围常驻", () => {
  it("每份读模型都带 visibility，且文案取自契约单源", () => {
    expect(threadKnowledgeNormal.visibility).toBe("owner_only");
    expect(threadKnowledgeReadOnly.visibility).toBe("thread_members");
    expect(KG_VISIBILITY_LABEL_ZH.owner_only).toBe("仅你可见");
    expect(KG_VISIBILITY_LABEL_ZH.thread_members).toBe("会话成员可见");
  });
});

describe("U-3 记入长期记忆", () => {
  it("「AI 记下的」也能被记入（不再有『需先确认』拒绝码）", () => {
    const codes = promotionResultsMixed.results
      .filter((r) => r.outcome === "rejected")
      .map((r) => (r.outcome === "rejected" ? r.code : ""));
    expect(codes).not.toContain("KG_PROMOTE_REQUIRES_ACCEPTED");
    // proposed 的一条也出现 promoted
    const promotedIds = promotionResultsMixed.results.filter((r) => r.outcome === "promoted").map((r) => r.claimId);
    expect(promotedIds).toContain("clm-todo-migrate");
  });
});

describe("关联/相似查询降级", () => {
  it("图或向量任一路不可用即判『查不全』，文案固定", () => {
    expect(relatedQueryDegraded(channelHealthAllOk)).toBe(false);
    expect(relatedQueryDegraded(channelHealthGraphDown)).toBe(true);
    expect(relatedQueryDegraded(channelHealthVectorDown)).toBe(true);
    expect(KG_RELATED_QUERY_DEGRADED_ZH).toContain("没能查全你的记忆");
  });
});

describe("E6 说人话：界面文案不含内部术语", () => {
  const surfaces: string[] = [
    ...Object.values(KG_TRI_STATE_LABEL_ZH),
    ...Object.values(KG_VISIBILITY_LABEL_ZH),
    ...Object.values(KG_CLAIM_KIND_LABEL_ZH),
    ...Object.values(KG_OBJECT_KIND_LABEL_ZH),
    ...Object.values(RETRIEVAL_CHANNEL_LABEL_ZH),
    KG_RELATED_QUERY_DEGRADED_ZH,
  ];

  it("所有对用户展示的标签都不出现禁用词", () => {
    for (const text of surfaces) {
      for (const banned of KG_BANNED_USER_FACING_WORDS) {
        expect(text.includes(banned), `「${text}」含禁用词「${banned}」`).toBe(false);
      }
    }
  });
});
