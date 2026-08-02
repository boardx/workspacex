import { describe, expect, it } from "vitest";
import { batchConfirmAndWriteBackToBrain, mergeIntoPlenaryGraph, type ClaimRecord } from "../../src/domain/canvas/backflow";
import type { z } from "zod";
import { canvas as C } from "@repo/contracts";

type NodeProvenanceT = z.infer<typeof C.NodeProvenance>;

/**
 * F107 — 只有组长确认过的节点才写回组织大脑（I-29），批量确认部分成功常态，
 * 互斥结论自动标 contested 且不自动择一（I-30）。
 *
 * ## 这份测试在防什么
 *
 * ① **I-29 是服务端闸门**：直接对未确认（`proposed`）或冲突中（`contested`）的节点
 *    调用写回接口必须被拒 `NODE_NOT_CONFIRMED`——绕过界面直调也一样，不是"前端按钮
 *    置灰"就算实现了这条约束。
 * ② **部分成功是常态**：一批 claimId 里有的通过、有的被拒，返回 `written` +
 *    `rejected` 两个列表，**不是整批失败也不是静默跳过**被拒的那条。
 * ③ **并发**（V9）：`expectedRevision` 与实际版本不一致时整批拒绝 `VERSION_CHANGED`，
 *    不做部分写入。
 * ④ **I-30 互斥结论**：两条互斥的 claim 经 `mergeIntoPlenaryGraph` 后都被标
 *    `contested`，两条边都保留在结果里（不删除任一侧），且不提供"系统择一"的路径——
 *    之后这两条 claim 即使被送进批量确认也会被 NODE_NOT_CONFIRMED 挡住
 *    （`contested` 不是 `accepted`，同一闸门覆盖两条不变量）。
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

describe("F107 · 只有组长确认才写回组织大脑（I-29）+ 部分成功 + 互斥冲突（I-30）", () => {
  it("已确认（accepted）且来源链完整的节点 ⟹ 写回成功", () => {
    const claims: ClaimRecord[] = [
      { claimId: "c1", status: "accepted", provenance: fullProvenance(), mutuallyExclusiveWith: null },
    ];
    const result = batchConfirmAndWriteBackToBrain({
      claimIds: ["c1"],
      allClaims: claims,
      expectedRevision: 1,
      currentRevision: 1,
    });
    expect(result).toEqual({ written: ["c1"], rejected: [] });
  });

  it("未确认（proposed）节点 ⟹ 拒绝 NODE_NOT_CONFIRMED，即使绕过界面直调", () => {
    const claims: ClaimRecord[] = [
      { claimId: "c-proposed", status: "proposed", provenance: fullProvenance(), mutuallyExclusiveWith: null },
    ];
    const result = batchConfirmAndWriteBackToBrain({
      claimIds: ["c-proposed"],
      allClaims: claims,
      expectedRevision: 1,
      currentRevision: 1,
    });
    expect(result).toEqual({ written: [], rejected: [{ claimId: "c-proposed", reason: "NODE_NOT_CONFIRMED" }] });
  });

  it("冲突中（contested）节点 ⟹ 同样拒绝 NODE_NOT_CONFIRMED（只有 accepted 才通过）", () => {
    const claims: ClaimRecord[] = [
      { claimId: "c-contested", status: "contested", provenance: fullProvenance(), mutuallyExclusiveWith: "c-other" },
    ];
    const result = batchConfirmAndWriteBackToBrain({
      claimIds: ["c-contested"],
      allClaims: claims,
      expectedRevision: 1,
      currentRevision: 1,
    });
    expect(result.rejected).toEqual([{ claimId: "c-contested", reason: "NODE_NOT_CONFIRMED" }]);
  });

  it("已确认但来源链断 ⟹ 拒绝 SOURCE_CHAIN_BROKEN（NODE_NOT_CONFIRMED 判定顺序在前，链断判定在后）", () => {
    const claims: ClaimRecord[] = [
      { claimId: "c-broken", status: "accepted", provenance: fullProvenance({ anchor: "" }), mutuallyExclusiveWith: null },
    ];
    const result = batchConfirmAndWriteBackToBrain({
      claimIds: ["c-broken"],
      allClaims: claims,
      expectedRevision: 1,
      currentRevision: 1,
    });
    expect(result).toEqual({ written: [], rejected: [{ claimId: "c-broken", reason: "SOURCE_CHAIN_BROKEN" }] });
  });

  it("部分成功是常态：一批里一条通过、一条未确认、一条链断 ⟹ 三条各自独立判定，互不影响", () => {
    const claims: ClaimRecord[] = [
      { claimId: "c-ok", status: "accepted", provenance: fullProvenance(), mutuallyExclusiveWith: null },
      { claimId: "c-unconfirmed", status: "proposed", provenance: fullProvenance(), mutuallyExclusiveWith: null },
      { claimId: "c-broken", status: "accepted", provenance: fullProvenance({ quote: "" }), mutuallyExclusiveWith: null },
    ];
    const result = batchConfirmAndWriteBackToBrain({
      claimIds: ["c-ok", "c-unconfirmed", "c-broken"],
      allClaims: claims,
      expectedRevision: 1,
      currentRevision: 1,
    });
    expect(result.written).toEqual(["c-ok"]);
    expect(result.rejected).toEqual(
      expect.arrayContaining([
        { claimId: "c-unconfirmed", reason: "NODE_NOT_CONFIRMED" },
        { claimId: "c-broken", reason: "SOURCE_CHAIN_BROKEN" },
      ]),
    );
    expect(result.rejected).toHaveLength(2);
  });

  it("并发（V9）：expectedRevision 与当前版本不一致 ⟹ 整批拒绝 VERSION_CHANGED，不做部分写入", () => {
    const claims: ClaimRecord[] = [
      { claimId: "c1", status: "accepted", provenance: fullProvenance(), mutuallyExclusiveWith: null },
      { claimId: "c2", status: "accepted", provenance: fullProvenance(), mutuallyExclusiveWith: null },
    ];
    const result = batchConfirmAndWriteBackToBrain({
      claimIds: ["c1", "c2"],
      allClaims: claims,
      expectedRevision: 1,
      currentRevision: 2,
    });
    expect(result.written).toEqual([]);
    expect(result.rejected).toEqual([
      { claimId: "c1", reason: "VERSION_CHANGED" },
      { claimId: "c2", reason: "VERSION_CHANGED" },
    ]);
  });

  it("I-30：互斥结论双向确认 ⟹ 两条都标 contested，两侧边都保留（不删除任一侧、不自动择一）", () => {
    const claims: ClaimRecord[] = [
      { claimId: "claim-support", status: "accepted", provenance: fullProvenance(), mutuallyExclusiveWith: "claim-rebut" },
      { claimId: "claim-rebut", status: "accepted", provenance: fullProvenance(), mutuallyExclusiveWith: "claim-support" },
    ];
    const result = mergeIntoPlenaryGraph(["claim-support", "claim-rebut"], claims);

    expect(new Set(result.contested)).toEqual(new Set(["claim-support", "claim-rebut"]));
    expect(result.merged).toBe(0);

    const support = result.claims.find((c) => c.claimId === "claim-support")!;
    const rebut = result.claims.find((c) => c.claimId === "claim-rebut")!;
    expect(support.status).toBe("contested");
    expect(rebut.status).toBe("contested");
    // 两侧都还在结果集合里——系统没有删除任一侧。
    expect(result.claims).toHaveLength(2);
  });

  it("单侧指向另一条但对方未确认互斥关系 ⟹ 不构成双向互斥，不标 contested", () => {
    const claims: ClaimRecord[] = [
      { claimId: "a", status: "accepted", provenance: fullProvenance(), mutuallyExclusiveWith: "b" },
      { claimId: "b", status: "accepted", provenance: fullProvenance(), mutuallyExclusiveWith: null },
    ];
    const result = mergeIntoPlenaryGraph(["a", "b"], claims);
    expect(result.contested).toEqual([]);
    expect(result.merged).toBe(2);
  });

  it("互斥后的 contested claim 送进批量确认 ⟹ 同样被 NODE_NOT_CONFIRMED 挡住（两条不变量共用一个闸门）", () => {
    const claims: ClaimRecord[] = [
      { claimId: "claim-support", status: "accepted", provenance: fullProvenance(), mutuallyExclusiveWith: "claim-rebut" },
      { claimId: "claim-rebut", status: "accepted", provenance: fullProvenance(), mutuallyExclusiveWith: "claim-support" },
    ];
    const merged = mergeIntoPlenaryGraph(["claim-support", "claim-rebut"], claims);
    const writeback = batchConfirmAndWriteBackToBrain({
      claimIds: ["claim-support", "claim-rebut"],
      allClaims: merged.claims,
      expectedRevision: 1,
      currentRevision: 1,
    });
    expect(writeback.written).toEqual([]);
    expect(writeback.rejected).toEqual(
      expect.arrayContaining([
        { claimId: "claim-support", reason: "NODE_NOT_CONFIRMED" },
        { claimId: "claim-rebut", reason: "NODE_NOT_CONFIRMED" },
      ]),
    );
  });
});
