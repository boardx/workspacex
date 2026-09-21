/**
 * 2026-09-22 —— 失败之后那句「下一步」。
 *
 * 为什么这是缺陷：既有失败文案是照云端写的，到处是「请联系管理员」。本地版单人单机，
 * 用户自己就是管理员——让他去找一个不存在的人，等于告诉他没救了，而真实情况往往是
 * 「重发一次就好」或者「日志在这个路径下」。
 */
import { expect, it } from "vitest";
import { wave2Runtime } from "@repo/contracts";
import { LOCAL_FAILURE_NEXT_STEP, failureNextStep } from "@repo/contracts/deployment";
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
