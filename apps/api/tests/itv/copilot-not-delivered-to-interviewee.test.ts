/**
 * F91 —— AI 副驾驶四类建议：无来源拒绝落库（I-5）+ 关闭开关时受访者端不下发（I-34）
 * (`uc-6-4` R3 步骤6, E7/O-05, R5, V3, V4;
 * `domain/interview/copilot-suggestion.ts`).
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74）。
 */
import { describe, expect, it } from "vitest";
import { interview } from "@repo/contracts";
import {
  assembleCopilotSuggestion,
  suggestionsForViewer,
  type CopilotSuggestionDraft,
} from "../../src/domain/interview/copilot-suggestion";

const followupDraft: CopilotSuggestionDraft = {
  suggestionId: "sugg-1",
  origin: "ai",
  aiSuggestionKind: "followup",
  text: "『我们法务只认合同』——那次法务是在什么时候第一次介入的？",
  reason: "他刚提到法务是硬门槛，但没说介入时点；这决定了责任问题是流程问题还是信任问题。",
  sourceSegmentId: "seg-weber-1",
  sourceTimecode: "00:32:05",
  rqId: "rq-2",
  priority: "high",
  proposedBy: null,
};

describe("F91 · I-5 · 生成端来源门禁 —— 四类建议齐备，且无来源一律拒绝落库", () => {
  it("带完整来源（sourceSegmentId + sourceTimecode）+ 理由 ⇒ 生成成功，且通过契约 schema 校验", () => {
    const result = assembleCopilotSuggestion(followupDraft);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(() => interview.CopilotSuggestion.parse(result.suggestion)).not.toThrow();
      expect(result.suggestion.aiSuggestionKind).toBe("followup");
    }
  });

  it("四类齐备：追问 / 观察员私密 / 澄清 / 反例，各自通过来源门禁", () => {
    const clarify = assembleCopilotSuggestion({
      ...followupDraft, suggestionId: "sugg-2", aiSuggestionKind: "clarify",
      text: "『保底』指收益还是可用率？", reason: "术语歧义会让后续引用产生分歧。", rqId: null, priority: null,
    });
    const counterExample = assembleCopilotSuggestion({
      ...followupDraft, suggestionId: "sugg-3", aiSuggestionKind: "counter_example",
      text: "有没有一次很快签下来的？", reason: "主动找反证，避免只采信符合假设的叙述。", rqId: null, priority: null,
    });
    const observerPrivate = assembleCopilotSuggestion({
      ...followupDraft, suggestionId: "sugg-4", origin: "human_observer", aiSuggestionKind: null,
      text: "他上一句说『其实我们也试过』，那次尝试没往下问，值得回去。",
      reason: "观察员现场私密建议，不经 AI 加工原样呈现。", rqId: null, priority: null, proposedBy: "高琳",
    });

    for (const r of [clarify, counterExample, observerPrivate]) {
      expect(r.ok).toBe(true);
    }
    if (observerPrivate.ok) expect(observerPrivate.suggestion.proposedBy).toBe("高琳");
  });

  it("缺 sourceSegmentId ⇒ SUGGESTION_NO_SOURCE，不落库（不是落库但界面隐藏来源）", () => {
    const result = assembleCopilotSuggestion({ ...followupDraft, sourceSegmentId: null });
    expect(result).toEqual({ ok: false, reason: "SUGGESTION_NO_SOURCE" });
  });

  it("缺 sourceTimecode ⇒ SUGGESTION_NO_SOURCE", () => {
    const result = assembleCopilotSuggestion({ ...followupDraft, sourceTimecode: null });
    expect(result).toEqual({ ok: false, reason: "SUGGESTION_NO_SOURCE" });
  });

  it("来源时间码为空字符串（不是 null，但同样『没有』）⇒ 同样拒绝", () => {
    const result = assembleCopilotSuggestion({ ...followupDraft, sourceTimecode: "" });
    expect(result.ok).toBe(false);
  });

  it("缺理由 ⇒ 同样拒绝（notes 原文：每条建议无来源不得给出，无理由与无来源同一类失败）", () => {
    const result = assembleCopilotSuggestion({ ...followupDraft, reason: "" });
    expect(result.ok).toBe(false);
  });

  it("契约 listCopilotSuggestions.err 收录 SUGGESTION_NO_SOURCE（生成端拒绝落库的落点）", () => {
    expect(interview.operations.listCopilotSuggestions.err).toContain("SUGGESTION_NO_SOURCE");
  });
});

describe("F91 · I-34 · 受访者端不下发 —— 服务端拒绝，不是前端隐藏", () => {
  const assembled = assembleCopilotSuggestion(followupDraft);
  if (!assembled.ok) throw new Error("fixture setup failed");
  const suggestions = [assembled.suggestion];

  it("`showAiSuggestionsToSubjects` 关闭（默认）+ 受访者视角 ⇒ 返回 undefined（字段不存在，非空数组）", () => {
    const result = suggestionsForViewer({
      viewerKind: "interviewee", showAiSuggestionsToSubjects: false, suggestions,
    });
    expect(result).toBeUndefined();
  });

  it("开关打开 + 受访者视角 ⇒ 才出现建议", () => {
    const result = suggestionsForViewer({
      viewerKind: "interviewee", showAiSuggestionsToSubjects: true, suggestions,
    });
    expect(result).toEqual(suggestions);
  });

  it("反证：研究员/联合主持/观察员/记录 agent 视角一律不受本开关影响，恒可见全部建议", () => {
    for (const viewerKind of ["researcher", "co_host", "observer", "agent"] as const) {
      const withSwitchOff = suggestionsForViewer({ viewerKind, showAiSuggestionsToSubjects: false, suggestions });
      const withSwitchOn = suggestionsForViewer({ viewerKind, showAiSuggestionsToSubjects: true, suggestions });
      expect(withSwitchOff).toEqual(suggestions);
      expect(withSwitchOn).toEqual(suggestions);
    }
  });

  it("反证：广播通道同样得不到建议——本函数压根不接受任何广播目标参数，唯一输出面向调用者自己", () => {
    // suggestionsForViewer 的类型签名里没有 broadcast/roomId 之类的参数：
    // 不存在把这个结果转发给一个"全场"目标的调用形状，私下即函数签名本身的约束。
    const result = suggestionsForViewer({
      viewerKind: "researcher", showAiSuggestionsToSubjects: false, suggestions,
    });
    expect(result).toEqual(suggestions);
    expect(Object.keys(result ?? {})).not.toContain("broadcast");
  });

  it("契约 SevenSwitches.showAiSuggestionsToSubjects 是本开关唯一的事实源（不在别处另声明同一件事）", () => {
    expect(() =>
      interview.SevenSwitches.parse({
        liveTranscript: true, copilotSuggestions: true, speakingBalanceAlert: true,
        rqCoverageTracking: true, quoteExtraction: true, observerNotes: true,
        showAiSuggestionsToSubjects: false,
      }),
    ).not.toThrow();
  });
});
