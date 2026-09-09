/**
 * issue #3211 ① 前端半边 —— 「模型这次没能返回可用结果」这一句必须能带上**为什么**。
 *
 * 人类 2026-09-09 实测那一条（8 分钟、6 次工具调用、零产出）的核心问题不是文案不够
 * 委婉，是那句话对四件可行动性完全不同的事说了同一句话。下面每条钉住一对「必须不同」。
 *
 * ⚠ 既有断言（`copilotkit-v2-error-copy.test.ts` / `chat-read-screen.test.tsx` 里
 * 「模型这次没能返回可用结果」那几条）一条没动、一条没放宽：成因缺席时逐字回落到旧文案。
 */
import { describe, expect, it } from "vitest";
import { wave2Runtime } from "@repo/contracts";
import { describeAgentRunError, describeAgentRunFailure } from "@/lib/agent-run";
import { describeCopilotkitV2RunError } from "@/lib/copilotkit-v2-error-copy";

describe("#3211 ① 失败成因的人读文案", () => {
  it("成因缺席时逐字回落到旧文案 —— 不编成因", () => {
    expect(describeAgentRunFailure("MODEL_CALL_FAILED", null)).toBe(describeAgentRunError("MODEL_CALL_FAILED"));
    expect(describeAgentRunFailure("MODEL_CALL_FAILED")).toBe("模型这次没能返回可用结果");
    expect(describeCopilotkitV2RunError("MODEL_CALL_FAILED")).toBe("模型这次没能返回可用结果");
  });

  it("同一个 code、不同成因 ⇒ 用户看到的句子必须不同", () => {
    const seen = new Set<string>();
    for (const reason of wave2Runtime.AgentRunFailureReason.options) {
      const text = describeAgentRunFailure("MODEL_CALL_FAILED", reason);
      expect(text, `${reason} 必须比裸文案多说点什么`).not.toBe("模型这次没能返回可用结果");
      expect(text.startsWith("模型这次没能返回可用结果"), "旧文案仍是句首，不推翻既有措辞").toBe(true);
      seen.add(text);
    }
    // 八个成因 ⇒ 八句互不相同的话。少一句就说明有两件事又合并了。
    expect(seen.size).toBe(wave2Runtime.AgentRunFailureReason.options.length);
  });

  it("`executor_defect`（我们自己的 bug）不许说成模型的问题", () => {
    const text = describeAgentRunFailure("MODEL_CALL_FAILED", "executor_defect");
    expect(text).toContain("我们服务端的缺陷");
    expect(text).not.toBe(describeAgentRunFailure("MODEL_CALL_FAILED", "provider_returned_empty"));
  });

  it("`unknown` 与「成因缺席」是两句不同的话（老 run vs 分类器没覆盖）", () => {
    expect(describeAgentRunFailure("MODEL_CALL_FAILED", "unknown"))
      .not.toBe(describeAgentRunFailure("MODEL_CALL_FAILED", null));
  });

  it("AG-UI 传输层码没有成因，不受影响", () => {
    expect(describeCopilotkitV2RunError("AGENT_RUN_TIMEOUT")).toBe("这次执行超时了，还没有等到结果");
    expect(describeCopilotkitV2RunError("MODEL_CALL_FAILED", "provider_timeout"))
      .toBe(describeAgentRunFailure("MODEL_CALL_FAILED", "provider_timeout"));
  });
});
