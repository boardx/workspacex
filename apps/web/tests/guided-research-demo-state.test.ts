import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  advanceDemoTask,
  decideDemoSource,
  loadGuidedResearchDemoState,
  saveGuidedResearchDemoState,
} from "@/lib/mock/guided-research-demo-state";

const sessionId = "demo-session";
const storageKey = `wsx.guidedResearch.demo.v1.${sessionId}`;

describe("guided research demo state", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
  });

  it("falls back to a deterministic fixture when storage is corrupt", () => {
    window.localStorage.setItem(storageKey, "not json");

    expect(loadGuidedResearchDemoState(sessionId)).toEqual({
      version: 1,
      sessionId,
      completedTaskIds: [],
      sourceDecisions: {},
      reportSummary: "",
    });
  });

  it("adds a demo task only once", () => {
    const initial = loadGuidedResearchDemoState(sessionId);
    const advanced = advanceDemoTask(initial, "task-market");

    expect(advanceDemoTask(advanced, "task-market")).toEqual(advanced);
  });

  it("keeps source decisions isolated by session", () => {
    const first = decideDemoSource(loadGuidedResearchDemoState("first"), "source-a", "accepted");
    const second = decideDemoSource(loadGuidedResearchDemoState("second"), "source-a", "excluded");

    expect(first.sourceDecisions).toEqual({ "source-a": "accepted" });
    expect(second.sourceDecisions).toEqual({ "source-a": "excluded" });
  });

  it("reloads a saved versioned state with its tasks and decisions", () => {
    const state = decideDemoSource(
      advanceDemoTask(loadGuidedResearchDemoState(sessionId), "task-market"),
      "source-a",
      "accepted",
    );
    saveGuidedResearchDemoState(state);

    expect(loadGuidedResearchDemoState(sessionId)).toEqual(state);
  });
});
