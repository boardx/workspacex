/**
 * issue #3403 ④ —— 「失败原因说错了」。
 *
 * 人类 2026-09-11 实测：PPT 生成 17:29 后失败，计划面板那张恢复卡逐字写着
 * 「这次任务执行失败 / 模型这次没能返回可用结果」。**真正失败的是渲染脚本
 * `render-office.py`**——把脚本/工具的失败说成模型的失败，会把排查引向完全错误的方向。
 *
 * 判据刻意落在「**用户看见的那句话说出了真实成因**」，不是「有没有错误信息」：
 * 改动前这张卡也有一句话，它只是说错了对象。所以断言同时要求
 *   ① 那句话不再把成因归给模型；② 那句话指得出是工具/脚本。
 *
 * 为什么这张卡逃过了 #3280 / #3323：那两条把成因接到了 `AgentRunView` 的两处失败面上，
 * 而这张卡消费的是**计划账本**，契约里此前根本没有 `failureReason` 字段可读。
 */
import { describe, expect, it } from "vitest";
import { describePlanFailureReason } from "@/lib/plan-control-copy";
import { describeAgentRunError } from "@/lib/agent-run";

const MODEL_BLAME = describeAgentRunError("MODEL_CALL_FAILED"); // 「模型这次没能返回可用结果」

describe("#3403 ④ plan failure card names the real cause", () => {
  it("工具调用没回来时，那句话指向工具，不再只说模型没返回", () => {
    const line = describePlanFailureReason("MODEL_CALL_FAILED", "tool_call_unresolved");
    expect(line).toContain("工具调用");
    // 决定性的一条：它不能再是那句把成因归给模型的话。
    expect(line).not.toBe(MODEL_BLAME);
    expect(line).toContain("不是模型没出话");
  });

  it("反证：成因缺席（老 run）时逐字退回原文案——不编一个成因出来", () => {
    expect(describePlanFailureReason("MODEL_CALL_FAILED", null)).toBe(MODEL_BLAME);
    expect(describePlanFailureReason("MODEL_CALL_FAILED")).toBe(MODEL_BLAME);
  });

  it("反证：真的是模型返回空时，仍然说模型——新成因没有把所有失败都改判成工具问题", () => {
    const line = describePlanFailureReason("MODEL_CALL_FAILED", "provider_returned_empty");
    expect(line).not.toContain("工具调用");
    expect(line).toContain("模型");
  });
});
