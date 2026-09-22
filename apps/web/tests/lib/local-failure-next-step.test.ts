/**
 * 2026-09-22 —— 失败之后那句「下一步」。
 *
 * 为什么这是缺陷：既有失败文案是照云端写的，到处是「请联系管理员」。本地版单人单机，
 * 用户自己就是管理员——让他去找一个不存在的人，等于告诉他没救了，而真实情况往往是
 * 「重发一次就好」或者「日志在这个路径下」。
 */
import { expect, it } from "vitest";
import { wave2Runtime } from "@repo/contracts";
import { LOCAL_ERROR_NEXT_STEP, LOCAL_FAILURE_NEXT_STEP, failureNextStep } from "@repo/contracts/deployment";
import { describeAgentRunFailure, describeAgentRunFailureForEdition } from "@/lib/agent-run";
import { describePlanFailureReason } from "@/lib/plan-control-copy";

const REASONS = wave2Runtime.AgentRunFailureReason.options;

it("covers every failure reason the contract declares -- no silent gap", () => {
  expect(Object.keys(LOCAL_FAILURE_NEXT_STEP).sort()).toEqual([...REASONS].sort());
  for (const reason of REASONS) {
    const said = LOCAL_FAILURE_NEXT_STEP[reason];
    expect(said.length).toBeGreaterThan(10);
    // 本地版不许再出现「联系管理员」这种指向一个不存在的人的建议
    expect(said).not.toContain("联系管理员");
  }
});

it("adds the next step locally and changes nothing online", () => {
  for (const reason of REASONS) {
    const cloud = describeAgentRunFailureForEdition("MODEL_CALL_FAILED", reason, "cloud");
    // 反证：在线版必须与既有函数**逐字**相同
    expect(cloud).toBe(describeAgentRunFailure("MODEL_CALL_FAILED", reason));
    const local = describeAgentRunFailureForEdition("MODEL_CALL_FAILED", reason, "local");
    expect(local.startsWith(cloud)).toBe(true);
    expect(local).toContain("下一步：");
    expect(local).toContain(LOCAL_FAILURE_NEXT_STEP[reason]);
  }
});

it("says nothing extra when the reason is unknown to us", () => {
  // 成因缺席 ⇒ 不编一句建议出来
  expect(failureNextStep("local", null)).toBeNull();
  expect(failureNextStep("local", undefined)).toBeNull();
  expect(describeAgentRunFailureForEdition("MODEL_CALL_FAILED", null, "local"))
    .toBe(describeAgentRunFailure("MODEL_CALL_FAILED", null));
});

it("the plan failure card defaults to the cloud wording and opts in per call", () => {
  const reason = "tool_call_unresolved" as const;
  expect(describePlanFailureReason("MODEL_CALL_FAILED", reason))
    .toBe(describePlanFailureReason("MODEL_CALL_FAILED", reason, "cloud"));
  expect(describePlanFailureReason("MODEL_CALL_FAILED", reason, "local"))
    .toContain(LOCAL_FAILURE_NEXT_STEP[reason]);
});

/*
 * R12 —— 补上「只有终态码、没有成因」那一半。
 *
 * 这条路径在本地版**变得更常见，正是因为我们自己的改动**：出图那条现在会以
 * `MODEL_PROVIDER_NOT_CONFIGURED` 诚实失败（R8 把「悄悄出网然后 401」换成了「明确拒绝」），
 * 而它的原文案逐字是「所选模型服务尚未配置，请联系管理员」——本地版没有管理员。
 */
it("covers every terminal error code the contract declares", () => {
  expect(Object.keys(LOCAL_ERROR_NEXT_STEP).sort()).toEqual([...wave2Runtime.AgentRunError.options].sort());
  for (const [code, said] of Object.entries(LOCAL_ERROR_NEXT_STEP)) {
    if (said === null) continue;
    expect(said.length, code).toBeGreaterThan(10);
    expect(said, code).not.toContain("联系管理员");
  }
});

it("falls back to the code only when the reason has nothing to say, and never emits two", () => {
  // 没有成因 ⇒ 用码那张表
  const noReason = describeAgentRunFailureForEdition("MODEL_PROVIDER_NOT_CONFIGURED", null, "local");
  expect(noReason).toContain("下一步：");
  expect(noReason).toContain(LOCAL_ERROR_NEXT_STEP.MODEL_PROVIDER_NOT_CONFIGURED!);
  expect(noReason.match(/下一步：/g)).toHaveLength(1);

  // 有成因 ⇒ 成因优先，码那张表不叠上来
  const withReason = describeAgentRunFailureForEdition("MODEL_CALL_FAILED", "provider_timeout", "local");
  expect(withReason).toContain(LOCAL_FAILURE_NEXT_STEP.provider_timeout);
  expect(withReason.match(/下一步：/g)).toHaveLength(1);

  // 在线版逐字不变
  expect(describeAgentRunFailureForEdition("MODEL_PROVIDER_NOT_CONFIGURED", null, "cloud"))
    .toBe(describeAgentRunFailure("MODEL_PROVIDER_NOT_CONFIGURED", null));
});

it("says nothing for a code that needs no advice", () => {
  // 人工拒绝不需要「下一步」——用户自己就是那个拒绝的人
  expect(LOCAL_ERROR_NEXT_STEP.HITL_REJECTED).toBeNull();
  expect(describeAgentRunFailureForEdition("HITL_REJECTED", null, "local"))
    .toBe(describeAgentRunFailure("HITL_REJECTED", null));
});
