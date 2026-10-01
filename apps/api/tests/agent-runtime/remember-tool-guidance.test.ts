/**
 * issue #4344 ④ —— 系统提示：用户让记住什么就调 `wx_remember`；用户在卡上确认之前，绝不说「已经记住了」。
 * 这段只在原生执行档里有（只有那里挂着 `wx_remember`），其余模式逐字节不变。
 */
import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../src/application/agent-run/execute-run";
import { REMEMBER_TOOL_GUIDANCE } from "../../src/application/agent-run/standard-remember";
import { NATIVE_PROFILE_TOOLS } from "../../src/application/agent-run/native-invocation";

describe("#4344 记忆指引", () => {
  it("点名 wx_remember、说清只是开卡、禁止在确认前声称已保存", () => {
    expect(REMEMBER_TOOL_GUIDANCE).toContain("`wx_remember`");
    expect(REMEMBER_TOOL_GUIDANCE).toContain("不要说「已经记住了 / 已保存」");
    expect(REMEMBER_TOOL_GUIDANCE).toContain("点「记住」之后才进长期记忆");
    expect(REMEMBER_TOOL_GUIDANCE).not.toMatch(/wx_memory_/);
    // 指引点名的工具必须真的在原生准入表里（不留死名字）
    expect(NATIVE_PROFILE_TOOLS).toContain("wx_remember");
  });

  it("只在原生执行档且本轮挂了工具时拼进去；其余模式与缺省调用逐字节不变", () => {
    expect(buildSystemPrompt("I", [], null, "native", { remember: true })).toContain(REMEMBER_TOOL_GUIDANCE);
    expect(buildSystemPrompt("I", [], null, "native", { remember: false })).not.toContain("wx_remember");
    expect(buildSystemPrompt("I", [], null, "native")).toBe(buildSystemPrompt("I", [], null, "native", { remember: false }));
    for (const mode of ["full", "deep-agent-catalog"] as const) {
      expect(buildSystemPrompt("I", [], null, mode, { remember: true })).toBe(buildSystemPrompt("I", [], null, mode));
    }
  });
});
