/**
 * F56 / I-28 -- `publishState = 运行中 ⇒ 工具白名单非空`. 未配工具白名单提交发布被阻断；
 * **直接调接口置为运行中亦被拒并记审计**。
 *
 * `user_visible_behavior` 逐字：「未配工具白名单的 agent 提交发布被阻断（界面给出"还没配
 * 工具白名单，不能发布"），直接调接口置为运行中被拒并记审计」。
 *
 * This file covers what F55's `clone-drops-whitelist.test.ts` does not: the SUBMIT and
 * PUBLISH-DECISION gates themselves (not just the pure `checkWhitelistConfigured` predicate),
 * and the structural proof that no API surface in this bundle's contract can carry
 * `publishState` directly to `运行中` -- the only path is through `decideAgentPublish`.
 */
import { describe, expect, it } from "vitest";
import { agentRuntime as A } from "@repo/contracts";
import { submitAgentForReview, decideAgentPublish } from "../../../src/domain/agent/publish-review";
import { agent } from "./fixtures";

describe("F56 I-28 -- submitAgentForReview：未配白名单提交发布被阻断", () => {
  it("空白名单 ⇒ TOOL_WHITELIST_EMPTY，界面文案对应的码在契约里存在", () => {
    const result = submitAgentForReview(agent({ toolWhitelist: [] }));
    expect(result).toEqual({ ok: false, reason: "TOOL_WHITELIST_EMPTY" });
    expect(A.operations.submitAgentForReview.err).toContain("TOOL_WHITELIST_EMPTY");
  });

  it("反向：非空白名单 ⇒ 提交成功，进入待审核（不是一堵墙）", () => {
    const result = submitAgentForReview(agent());
    expect(result).toEqual({ ok: true, publishState: "待审核" });
  });
});

describe("F56 I-28 -- decideAgentPublish：直接调「批准发布」时白名单被清空也同样被拒", () => {
  const baseInput = {
    submitterId: "usr-submitter",
    actorId: "usr-methodology-reviewer",
    actorFunction: "methodologyReviewer" as const,
    decision: "批准发布" as const,
    securityScanPassed: true,
    methodologyPrecheckPassed: true,
  };

  it("白名单在提交之后、批准之前被清空 ⇒ 批准发布仍被拒（第二道独立闸门，不信任提交时的结果）", () => {
    const result = decideAgentPublish({
      ...baseInput,
      agent: agent({ toolWhitelist: [] }),
    });
    expect(result).toEqual({ ok: false, reason: "TOOL_WHITELIST_EMPTY" });
  });

  it("这是本 feature 唯一能把 publishState 推到运行中的路径：白名单非空 + 全部条件满足 ⇒ 运行中", () => {
    const result = decideAgentPublish({
      ...baseInput,
      agent: agent(),
    });
    expect(result).toEqual({ ok: true, publishState: "运行中" });
  });

  it("即使白名单非空，安全扫描未过仍被拒（白名单门不是唯一门）", () => {
    const result = decideAgentPublish({
      ...baseInput,
      agent: agent(),
      securityScanPassed: false,
    });
    expect(result).toEqual({ ok: false, reason: "SECURITY_SCAN_PENDING" });
  });
});

describe("F56 I-28 -- 直调接口置「运行中」被拒：结构性证明，不止是运行时判定", () => {
  it("createAgent 的输出恒不为运行中——新建/复制出的 agent 从不以运行中开局", () => {
    // AgentPublishState 的第一个成员是 "草稿"；createAgent 没有任何入参可以指定别的态。
    const createIn = A.operations.createAgent.in;
    expect("publishState" in createIn.shape).toBe(false);
  });

  it("updateAgentDefinition 的 patch 里没有 publishState 字段——常规编辑接口结构性地不能改发布态", () => {
    const patchShape = A.operations.updateAgentDefinition.in.shape.patch.shape;
    expect(Object.keys(patchShape)).not.toContain("publishState");
  });

  it("能把 agent 推向「运行中」的唯一操作是 decideAgentPublish，其入参也不接受直接写 publishState", () => {
    const publishIn = A.operations.decideAgentPublish.in;
    expect("publishState" in publishIn.shape).toBe(false);
    // 只接受 "批准发布" | "退回" 的决定，不接受直接指定目标态。
    expect(publishIn.shape.decision.options).toEqual(["批准发布", "退回"]);
  });

  it("submitAgentForReview 与 decideAgentPublish 的 err 都携带 TOOL_WHITELIST_EMPTY——两道闸门都声明了这条失败", () => {
    expect(A.operations.submitAgentForReview.err).toContain("TOOL_WHITELIST_EMPTY");
    expect(A.operations.decideAgentPublish.err).toContain("TOOL_WHITELIST_EMPTY");
  });
});
