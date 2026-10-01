import { describe, expect, it } from "vitest";
import { lastRespondingAgentId } from "@/lib/copilotkit-v2-persisted-messages";

describe("lastRespondingAgentId（刷新后恢复线程已选数字人，UIUX r4）", () => {
  it("取最后一条 assistant 消息的作者，跳过用户与排除的系统作者", () => {
    const msgs = [
      { role: "user" as const, authorId: "u1" },
      { role: "assistant" as const, authorId: "agent-pm" },
      { role: "user" as const, authorId: "u1" },
      { role: "assistant" as const, authorId: "persona" },
    ];
    expect(lastRespondingAgentId(msgs, ["persona"])).toBe("agent-pm");
    expect(lastRespondingAgentId(msgs)).toBe("persona");
  });
  it("没有 agent 回复 → null（保持自动匹配）", () => {
    expect(lastRespondingAgentId([{ role: "user", authorId: "u1" }])).toBeNull();
    expect(lastRespondingAgentId([])).toBeNull();
  });
});
