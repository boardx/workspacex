import { describe, expect, it } from "vitest";
import {
  confirmNode,
  getNodeProvenance,
  isProvenanceChainUnbroken,
  mapNodeStatusToClaimStatus,
  mergeIntoPlenaryGraph,
  type ClaimRecord,
} from "../../src/domain/canvas/backflow";
import type { z } from "zod";
import { canvas as C } from "@repo/contracts";

type NodeProvenanceT = z.infer<typeof C.NodeProvenance>;

/**
 * F107 — 来源链不断（I-28 / AC1 / AC3 / V1 / V4）。
 *
 * ## 这份测试在防什么
 *
 * ① 图谱上每个节点都必须能反查来源便签 → 来源引述 → 来源转录片段，六个字段
 *    （`groupId` / `sourceStickyId` / `quote` / `segmentId` / `anchor` / `transcriptFileRef`）
 *    任一为空即整条视为断链——不是"凑齐大多数就算完整"。
 * ② 断链的节点**不得写回**（`confirmNode` 拒绝、`getNodeProvenance` 拒绝），
 *    而不是"写回了但标一个警告"——I-28 是硬闸门，不是 F106 那种"只提示不阻断"。
 * ③ 链完整时正常成功，节点三态正确映射到 `claims.status`。
 * ④ `mergeIntoPlenaryGraph` 汇入时，只有来源链完整且状态 `accepted`（未互斥）的
 *    claim 才计入 `merged`——链断的即使被请求汇入也不计数。
 */

function fullProvenance(overrides: Partial<NodeProvenanceT> = {}): NodeProvenanceT {
  return {
    groupId: "group-3",
    sourceStickyId: "sticky-42",
    quote: "我们园区自己投自己用",
    segmentId: "seg-3#0142",
    anchor: "12:05",
    transcriptFileRef: "transcript.jsonl",
    ...overrides,
  };
}

describe("F107 · 来源链不断（I-28）", () => {
  it("六个字段齐全 ⟹ 来源链完整", () => {
    expect(isProvenanceChainUnbroken(fullProvenance())).toBe(true);
  });

  it.each(["groupId", "sourceStickyId", "quote", "segmentId", "anchor", "transcriptFileRef"] as const)(
    "%s 为空 ⟹ 整条视为断链",
    (field) => {
      const broken = fullProvenance({ [field]: "" });
      expect(isProvenanceChainUnbroken(broken)).toBe(false);
    },
  );

  it("provenance 为 null ⟹ 断链", () => {
    expect(isProvenanceChainUnbroken(null)).toBe(false);
  });

  it("confirmNode：来源链完整 ⟹ 成功，节点三态正确映射到 claims.status", () => {
    const result = confirmNode({
      makeClaimId: () => "claim-1",
      nodeStatus: "已确认",
      provenance: fullProvenance(),
      expectedVersionId: "v1",
      currentVersionId: "v1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.claimId).toBe("claim-1");
    expect(result.status).toBe("accepted");
    expect(result.provenance).toEqual(fullProvenance());
  });

  it("confirmNode：来源链断 ⟹ 拒绝 SOURCE_CHAIN_BROKEN，不产生 claim", () => {
    const result = confirmNode({
      makeClaimId: () => "claim-should-not-exist",
      nodeStatus: "已确认",
      provenance: fullProvenance({ anchor: "" }),
      expectedVersionId: "v1",
      currentVersionId: "v1",
    });
    expect(result).toEqual({ ok: false, reason: "SOURCE_CHAIN_BROKEN" });
  });

  it("confirmNode：版本已变化 ⟹ 先拒绝 VERSION_CHANGED（即使来源链完整）", () => {
    const result = confirmNode({
      makeClaimId: () => "claim-x",
      nodeStatus: "已确认",
      provenance: fullProvenance(),
      expectedVersionId: "v1",
      currentVersionId: "v2",
    });
    expect(result).toEqual({ ok: false, reason: "VERSION_CHANGED" });
  });

  it("节点三态 → claims.status 映射逐一正确", () => {
    expect(mapNodeStatusToClaimStatus("已确认")).toBe("accepted");
    expect(mapNodeStatusToClaimStatus("冲突")).toBe("contested");
    expect(mapNodeStatusToClaimStatus("待确认")).toBe("proposed");
  });

  it("getNodeProvenance：链完整 ⟹ 返回四项来源信息", () => {
    const claims: ClaimRecord[] = [
      { claimId: "c1", status: "accepted", provenance: fullProvenance(), mutuallyExclusiveWith: null },
    ];
    const result = getNodeProvenance("c1", claims);
    expect(result).toEqual({ ok: true, provenance: fullProvenance() });
  });

  it("getNodeProvenance：链断 ⟹ 拒绝 SOURCE_CHAIN_BROKEN", () => {
    const claims: ClaimRecord[] = [
      { claimId: "c1", status: "accepted", provenance: fullProvenance({ quote: "" }), mutuallyExclusiveWith: null },
    ];
    const result = getNodeProvenance("c1", claims);
    expect(result).toEqual({ ok: false, reason: "SOURCE_CHAIN_BROKEN" });
  });

  it("getNodeProvenance：claim 不存在 ⟹ 同样拒绝（不泄露存在性差异）", () => {
    const result = getNodeProvenance("does-not-exist", []);
    expect(result).toEqual({ ok: false, reason: "SOURCE_CHAIN_BROKEN" });
  });

  it("mergeIntoPlenaryGraph：链断的 accepted claim 不计入 merged", () => {
    const claims: ClaimRecord[] = [
      { claimId: "c-good", status: "accepted", provenance: fullProvenance(), mutuallyExclusiveWith: null },
      { claimId: "c-broken", status: "accepted", provenance: fullProvenance({ segmentId: "" }), mutuallyExclusiveWith: null },
    ];
    const result = mergeIntoPlenaryGraph(["c-good", "c-broken"], claims);
    expect(result.merged).toBe(1);
    expect(result.contested).toEqual([]);
  });
});
