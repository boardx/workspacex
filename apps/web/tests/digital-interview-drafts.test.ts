import { beforeEach, describe, expect, it, vi } from "vitest";
import { listMockDigitalInterviewDrafts } from "@/lib/mock/digital-interview-drafts";

const STORAGE_KEY = "wsx.mockDigitalInterviewDrafts.v1";

describe("Mock digital interview draft compatibility", () => {
  const values = new Map<string, string>();
  const localStorage = {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("window", { localStorage });
  });

  it("旧版草稿缺少流程字段时恢复为可确认主题的第一步", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      "mock-batch-legacy": {
        interviewId: "mock-batch-legacy",
        name: "旧版采购访谈",
        tags: ["采购"],
        topic: "",
        status: "draft",
        sourceQuickInterviewId: null,
        selectedExpertIds: [],
        reportId: null,
        updatedAt: "2026-08-12T05:00:00.000Z",
        version: 1,
      },
    }));

    expect(listMockDigitalInterviewDrafts()).toEqual([
      expect.objectContaining({
        interviewId: "mock-batch-legacy",
        currentStep: 1,
        questions: [],
        reportMarkdown: "",
        skillMessages: [],
        pendingSuggestion: null,
        undoSnapshot: null,
      }),
    ]);
  });
});
