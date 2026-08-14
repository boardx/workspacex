import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockDigitalInterviewDraft,
  createDefaultMockInterviewQuestions,
  deleteMockDigitalInterviewDraft,
  listMockDigitalInterviewDrafts,
  reconcileMockInterviewQuestions,
  updateMockDigitalInterviewMetadata,
} from "@/lib/mock/digital-interview-drafts";

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

  it("为每位专家生成三条不同目的的默认问题", () => {
    expect(createDefaultMockInterviewQuestions("expert-a")).toEqual([
      expect.objectContaining({ expertId: "expert-a", origin: "generated", purpose: "决策流程" }),
      expect.objectContaining({ expertId: "expert-a", origin: "generated", purpose: "否决风险" }),
      expect.objectContaining({ expertId: "expert-a", origin: "generated", purpose: "依据案例" }),
    ]);
  });

  it("重新确认专家时保留已编辑和手动问题，只为新专家补齐三问", () => {
    const edited = {
      ...createDefaultMockInterviewQuestions("expert-a")[0]!,
      text: "用户已经编辑的问题",
    };
    const manual = {
      questionId: "manual-a",
      expertId: "expert-a",
      text: "手动追问",
      origin: "manual" as const,
      purpose: "手动问题",
    };
    const removed = createDefaultMockInterviewQuestions("expert-removed")[0]!;

    const result = reconcileMockInterviewQuestions(
      ["expert-a", "expert-b"],
      [edited, manual, removed],
    );

    expect(result.filter((question) => question.expertId === "expert-a")).toEqual([
      edited,
      expect.objectContaining({ questionId: "expert-a:generated:2" }),
      expect.objectContaining({ questionId: "expert-a:generated:3" }),
      manual,
    ]);
    expect(result.filter((question) => question.expertId === "expert-b")).toHaveLength(3);
    expect(result.some((question) => question.expertId === "expert-removed")).toBe(false);
  });

  it("重新确认专家时不会恢复用户已删除的默认问题", () => {
    const defaults = createDefaultMockInterviewQuestions("expert-a");
    const result = reconcileMockInterviewQuestions(
      ["expert-a"],
      defaults.slice(1),
      [defaults[0]!.questionId],
    );

    expect(result.map((question) => question.questionId)).toEqual([
      "expert-a:generated:2",
      "expert-a:generated:3",
    ]);
  });

  it("读取旧版单问题时补齐稳定身份和来源", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      "mock-batch-question-legacy": {
        interviewId: "mock-batch-question-legacy",
        name: "旧问题草稿",
        tags: [],
        topic: "谁做决策？",
        selectedExpertIds: ["expert-a"],
        questions: [{ expertId: "expert-a", text: "旧问题" }],
      },
    }));

    expect(listMockDigitalInterviewDrafts()[0]?.questions).toEqual([
      expect.objectContaining({
        questionId: expect.any(String),
        expertId: "expert-a",
        text: "旧问题",
        origin: "generated",
      }),
    ]);
  });

  it("读取旧版草稿时去重专家，并为第四条以上问题生成唯一身份", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      "mock-batch-duplicates": {
        name: "重复旧草稿",
        selectedExpertIds: ["expert-a", "expert-a"],
        questions: Array.from({ length: 5 }, (_, index) => ({
          expertId: "expert-a",
          text: `旧问题 ${index + 1}`,
        })),
      },
    }));

    const draft = listMockDigitalInterviewDrafts()[0]!;
    expect(draft.selectedExpertIds).toEqual(["expert-a"]);
    expect(new Set(draft.questions.map((question) => question.questionId)).size).toBe(5);
  });

  it("读取旧版撤销快照时同步规范化专家和问题", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      "mock-batch-undo": {
        name: "旧撤销快照",
        selectedExpertIds: ["expert-a"],
        questions: [],
        undoSnapshot: {
          topic: "旧主题",
          selectedExpertIds: ["expert-a", "expert-a"],
          questions: [{ expertId: "expert-a", text: "撤销问题" }],
          reportMarkdown: "",
        },
      },
    }));

    expect(listMockDigitalInterviewDrafts()[0]?.undoSnapshot).toEqual(expect.objectContaining({
      selectedExpertIds: ["expert-a"],
      questions: [expect.objectContaining({ questionId: "expert-a:generated:1" })],
    }));
  });

  it("只更新 Mock 访谈名称与标签并保留流程内容", () => {
    const draft = createMockDigitalInterviewDraft({ name: "旧名称", tags: ["旧标签"] });

    const updated = updateMockDigitalInterviewMetadata(draft.interviewId, {
      name: " 新名称 ",
      tags: ["采购", "采购", " 德国 ", "储能", "决策", "B2B", "超限"],
    });

    expect(updated).toMatchObject({ name: "新名称", tags: ["采购", "德国", "储能", "决策", "B2B"] });
    expect(updated.currentStep).toBe(draft.currentStep);
    expect(updated.version).toBe(draft.version + 1);
  });

  it("拒绝更新 Mock 访谈为空白名称", () => {
    const draft = createMockDigitalInterviewDraft({ name: "访谈", tags: [] });

    expect(() => updateMockDigitalInterviewMetadata(draft.interviewId, { name: "  ", tags: [] }))
      .toThrow("MOCK_INTERVIEW_NAME_REQUIRED");
  });

  it("删除 Mock 草稿后不再出现在历史存储中", () => {
    const keep = createMockDigitalInterviewDraft({ name: "保留", tags: [] });
    const removed = createMockDigitalInterviewDraft({ name: "删除", tags: [] });

    deleteMockDigitalInterviewDraft(removed.interviewId);

    expect(listMockDigitalInterviewDrafts().map((draft) => draft.interviewId)).toEqual([keep.interviewId]);
  });

  it("拒绝删除非 Mock 访谈", () => {
    expect(() => deleteMockDigitalInterviewDraft("interview-real")).toThrow("MOCK_INTERVIEW_NOT_FOUND");
  });
});
