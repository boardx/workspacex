import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyResearchSkillSuggestion,
  cloneResearchEditableSnapshot,
  loadResearchSkillState,
  saveResearchSkillState,
  suggestionForResearchPrompt,
  type ResearchSkillState,
} from "@/lib/guided-research-skill-state";

const directionSnapshot = {
  step: "directions",
  value: [{ id: "d1", title: "市场", description: "规模", enabled: true, order: 0 }],
} as const;

const briefSnapshot = {
  step: "brief",
  value: { topic: "储能", goal: "进入市场", timeRange: "2026", region: "欧盟", focus: "政策" },
} as const;

const outlineSnapshot = {
  step: "outline",
  value: [{ id: "o1", title: "执行摘要", questions: ["关键判断？"], enabled: true, order: 0 }],
} as const;

const searchSnapshot = {
  step: "search",
  value: {
    version: 1,
    sessionId: "session-a",
    completedTaskIds: ["t1"],
    sourceDecisions: { s1: "accepted" },
    reportSummary: "原摘要",
  },
} as const;

const reportSnapshot = {
  step: "report",
  value: { reportSummary: "原摘要" },
} as const;

function state(): ResearchSkillState {
  return { version: 1, messages: [], pendingSuggestion: null, undoSnapshot: null };
}

describe("guided research skill state", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
  });

  it("adds a targeted direction without changing the existing snapshot", () => {
    const suggestion = suggestionForResearchPrompt("补充研究方向", directionSnapshot);
    const applied = applyResearchSkillSuggestion(suggestion, directionSnapshot);

    expect(applied.step).toBe("directions");
    if (applied.step !== "directions") throw new Error("expected a directions snapshot");
    expect(applied.value).toHaveLength(2);
    expect(applied.value.at(-1)).toMatchObject({ enabled: true, order: 1 });
    expect(directionSnapshot.value).toHaveLength(1);
  });

  it("changes only brief fields when applying a brief suggestion", () => {
    const applied = applyResearchSkillSuggestion(
      suggestionForResearchPrompt("补充研究目标", briefSnapshot),
      briefSnapshot,
    );

    expect(applied).toMatchObject({ step: "brief", value: { topic: "储能", region: "欧盟" } });
    if (applied.step !== "brief") throw new Error("expected a brief snapshot");
    expect(applied.value.goal).not.toBe(briefSnapshot.value.goal);
    expect(briefSnapshot.value.goal).toBe("进入市场");
  });

  it("adds an enabled ordered outline section", () => {
    const applied = applyResearchSkillSuggestion(
      suggestionForResearchPrompt("补充报告章节", outlineSnapshot),
      outlineSnapshot,
    );

    expect(applied.step).toBe("outline");
    if (applied.step !== "outline") throw new Error("expected an outline snapshot");
    expect(applied.value.at(-1)).toMatchObject({ enabled: true, order: 1 });
    expect(outlineSnapshot.value).toHaveLength(1);
  });

  it("completes only the next search task", () => {
    const applied = applyResearchSkillSuggestion(
      suggestionForResearchPrompt("完成下一项检索任务", searchSnapshot),
      searchSnapshot,
    );

    expect(applied.step).toBe("search");
    if (applied.step !== "search") throw new Error("expected a search snapshot");
    expect(applied.value.completedTaskIds).toEqual(["t1", "t2"]);
    expect(applied.value.sourceDecisions).toEqual({ s1: "accepted" });
    expect(applied.value.reportSummary).toBe("原摘要");
  });

  it("changes only the report summary for a report suggestion", () => {
    const applied = applyResearchSkillSuggestion(
      suggestionForResearchPrompt("完善报告摘要", reportSnapshot),
      reportSnapshot,
    );

    expect(applied).toEqual({
      step: "report",
      value: { reportSummary: "原摘要\n\n完善报告摘要" },
    });
  });

  it("restores the exact prior snapshot from undo state", () => {
    const applied = applyResearchSkillSuggestion(
      suggestionForResearchPrompt("补充研究方向", directionSnapshot),
      directionSnapshot,
    );
    const saved: ResearchSkillState = { ...state(), undoSnapshot: cloneResearchEditableSnapshot(directionSnapshot), pendingSuggestion: null };

    expect(saved.undoSnapshot).toEqual(directionSnapshot);
    expect(applied).not.toEqual(saved.undoSnapshot);
  });

  it("resets malformed storage and isolates messages by session key", () => {
    window.localStorage.setItem("wsx.guidedResearch.skill.v1.bad", "not json");
    saveResearchSkillState("first", {
      ...state(),
      messages: [{ id: "message-1", role: "user", text: "仅第一会话" }],
    });

    expect(loadResearchSkillState("bad")).toEqual(state());
    expect(loadResearchSkillState("first").messages).toEqual([
      { id: "message-1", role: "user", text: "仅第一会话" },
    ]);
    expect(loadResearchSkillState("second").messages).toEqual([]);
  });

  it("drops pending and undo snapshots that belong to another step", () => {
    saveResearchSkillState("shared", {
      ...state(),
      pendingSuggestion: suggestionForResearchPrompt("补充研究方向", directionSnapshot),
      undoSnapshot: cloneResearchEditableSnapshot(directionSnapshot),
    });

    expect(loadResearchSkillState("shared", "brief")).toEqual(state());
  });
});
