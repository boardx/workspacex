import { describe, expect, it } from "vitest";
import {
  DigitalInterviewDraftInput,
  DigitalInterviewStatus,
  DigitalInterviewWorkflowView,
  InterviewError,
  operations,
} from "../src/interview";

describe("数字专家访谈契约", () => {
  const scope = { kind: "none" as const, projectId: null, researchProjectId: null };
  const question = {
    questionId: "question-1", expertId: "expert-1", order: 1,
    text: "谁拥有否决权？", purpose: "识别决策权归属",
  };
  const draftWorkflow = {
    interviewId: "itv-digital-1", name: "德国采购决策链", tags: ["采购决策"], topic: null,
    scope,
    status: "topic_pending" as const, currentStep: "topic" as const, sourceQuickInterviewId: null,
    selectedExpertIds: [], expertCandidates: [], questions: [], questionCandidates: [],
    reportId: null, version: 1, revisionId: "rev-1",
    topicVersionId: null, expertSnapshotVersionId: null, questionVersionId: null,
    skillThreadId: "skill-thread-1", skillMessages: [], skillProposals: [],
  };
  const workflow = (version = 4) => ({
    interviewId: "itv-digital-1",
    name: "德国采购决策链",
    tags: ["采购决策"],
    scope,
    topic: "储能采购的否决权归属",
    status: "questions_pending" as const,
    currentStep: "questions" as const,
    sourceQuickInterviewId: null,
    selectedExpertIds: ["expert-1"],
    expertCandidates: [{
      expertId: "expert-1", agentDefinitionId: "agent-definition-1", agentVersion: "agent-version-1",
      initials: "DE", displayName: "德国采购总监", role: "采购决策", domains: ["采购"],
      materialContextPackId: "context-pack-1", materialVersion: "material-v1",
      materialBoundary: "材料版本 v1", exploratory: true,
    }],
    questions: [question],
    questionCandidates: [question],
    reportId: null,
    version,
    revisionId: "rev-1",
    topicVersionId: "topic-v1",
    expertSnapshotVersionId: "experts-v1",
    questionVersionId: "questions-v1",
    skillThreadId: "skill-thread-1",
    skillMessages: [
      {
        messageId: "message-1", skillThreadId: "skill-thread-1", role: "user" as const,
        text: "补充每位专家的反例问题", createdAt: "2026-08-15T10:00:00.000Z",
      },
    ],
    skillProposals: [
      {
        proposalId: "proposal-proposed", sourceMessageId: "message-1", targetStep: "questions" as const,
        baseRevisionId: "rev-1", patch: { questions: [question] }, status: "proposed" as const,
        createdAt: "2026-08-15T10:00:01.000Z", appliedAt: null, rejectedAt: null, committedVersionId: null,
      },
      {
        proposalId: "proposal-applied", sourceMessageId: "message-1", targetStep: "questions" as const,
        baseRevisionId: "rev-1", patch: { questions: [{ ...question, text: "反例是什么？" }] }, status: "applied_to_draft" as const,
        createdAt: "2026-08-15T10:00:02.000Z", appliedAt: "2026-08-15T10:00:03.000Z", rejectedAt: null, committedVersionId: null,
      },
      {
        proposalId: "proposal-rejected", sourceMessageId: "message-1", targetStep: "questions" as const,
        baseRevisionId: "rev-1", patch: { questions: [{ ...question, text: "重复问题" }] }, status: "rejected" as const,
        createdAt: "2026-08-15T10:00:04.000Z", appliedAt: null, rejectedAt: "2026-08-15T10:00:05.000Z", committedVersionId: null,
      },
      {
        proposalId: "proposal-committed", sourceMessageId: "message-1", targetStep: "topic" as const,
        baseRevisionId: "rev-0", patch: { topic: "采购链" }, status: "committed" as const,
        createdAt: "2026-08-15T10:00:06.000Z", appliedAt: "2026-08-15T10:00:07.000Z", rejectedAt: null, committedVersionId: "topic-v1",
      },
      {
        proposalId: "proposal-stale", sourceMessageId: "message-1", targetStep: "experts" as const,
        baseRevisionId: "rev-0", patch: { expertIds: ["expert-2"] }, status: "stale" as const,
        createdAt: "2026-08-15T10:00:08.000Z", appliedAt: null, rejectedAt: null, committedVersionId: null,
      },
    ],
  });

  it("只接受签核的八个工作流状态", () => {
    expect(DigitalInterviewStatus.options).toEqual([
      "draft", "topic_pending", "experts_pending", "questions_pending",
      "running", "report_pending", "completed", "failed",
    ]);
    expect(DigitalInterviewStatus.safeParse("scheduled").success).toBe(false);
  });

  it("草稿只保存非空名称和至少一个标签，主题留待显式确认", () => {
    expect(DigitalInterviewDraftInput.parse({
      name: " 德国采购决策链 ", tags: [" 采购决策 "],
    })).toEqual({ name: "德国采购决策链", tags: ["采购决策"] });

    for (const invalid of [
      { name: "", tags: ["采购"] },
      { name: "采购决策链", tags: [] },
      { name: "采购决策链", tags: ["采购"], topic: "不应在创建时写入" },
    ]) {
      expect(DigitalInterviewDraftInput.safeParse(invalid).success).toBe(false);
    }
  });

  it("草稿创建输入不含主题、严格拒绝未知字段且返回完整可恢复 workflow", () => {
    const input = operations.createDigitalInterviewDraft.in.parse({
      name: "采购决策链", tags: ["采购"], scope, requestId: "req-create-1",
    });
    expect(input).not.toHaveProperty("topic");
    expect(operations.createDigitalInterviewDraft.in.safeParse({ ...input, unknown: true }).success).toBe(false);
    expect(operations.createDigitalInterviewDraft.in.safeParse({ name: "采购", tags: ["采购"], scope }).success).toBe(false);

    const created = operations.createDigitalInterviewDraft.out.parse(draftWorkflow);
    expect(DigitalInterviewWorkflowView.parse(created)).toEqual(created);
    expect(created).toMatchObject({ status: "topic_pending", currentStep: "topic", topic: null, version: 1 });
    expect(DigitalInterviewWorkflowView.safeParse({ ...created, unknown: true }).success).toBe(false);
  });

  const persistedWrites = [
    {
      name: "确认主题", operation: operations.confirmDigitalInterviewTopic,
      input: { interviewId: "itv-1", topic: "谁拥有否决权", expectedVersion: 3, requestId: "req-topic-1" },
    },
    {
      name: "确认专家", operation: operations.confirmDigitalInterviewExperts,
      input: { interviewId: "itv-1", expertIds: ["expert-1"], expectedVersion: 3, requestId: "req-experts-1" },
    },
    {
      name: "确认问题", operation: operations.confirmDigitalInterviewQuestions,
      input: { interviewId: "itv-1", questions: [question], expectedVersion: 3, requestId: "req-q-1" },
    },
    {
      name: "追加 Skill 消息", operation: operations.appendDigitalInterviewSkillMessage,
      input: {
        interviewId: "itv-1", currentStep: "questions", text: "补充反例",
        draftContext: { step: "questions", questions: [question] },
        expectedVersion: 3, requestId: "req-skill-message-1",
      },
    },
    {
      name: "应用 Skill 建议", operation: operations.applyDigitalInterviewSkillProposal,
      input: { interviewId: "itv-1", proposalId: "proposal-applied", expectedVersion: 3, requestId: "req-skill-apply-1" },
    },
    {
      name: "拒绝 Skill 建议", operation: operations.rejectDigitalInterviewSkillProposal,
      input: { interviewId: "itv-1", proposalId: "proposal-rejected", expectedVersion: 3, requestId: "req-skill-reject-1" },
    },
  ] as const;

  it.each(persistedWrites)("$name 严格要求请求键和 aggregate 版本", ({ operation, input }) => {
    const parsed = operation.in.parse(input);
    expect(parsed).toMatchObject({ expectedVersion: 3, requestId: expect.any(String) });
    expect(operation.in.safeParse({ ...input, unknown: true }).success).toBe(false);
    expect(operation.in.safeParse({ ...input, requestId: undefined }).success).toBe(false);
    expect(operation.in.safeParse({ ...input, expectedVersion: undefined }).success).toBe(false);
    expect(operation.out.parse(workflow(parsed.expectedVersion + 1)).version).toBe(parsed.expectedVersion + 1);
  });

  it("确认数据拒绝空白、非法枚举和重复专家或问题标识", () => {
    expect(operations.confirmDigitalInterviewTopic.in.safeParse({
      interviewId: "itv-1", topic: "   ", expectedVersion: 3, requestId: "req-topic-2",
    }).success).toBe(false);
    expect(operations.confirmDigitalInterviewExperts.in.safeParse({
      interviewId: "itv-1", expertIds: ["expert-1", "expert-1"], expectedVersion: 3, requestId: "req-experts-2",
    }).success).toBe(false);
    expect(operations.confirmDigitalInterviewExperts.in.safeParse({
      interviewId: "itv-1", expertIds: [""], expectedVersion: 3, requestId: "req-experts-3",
    }).success).toBe(false);
    expect(operations.confirmDigitalInterviewQuestions.in.safeParse({
      interviewId: "itv-1", questions: [], expectedVersion: 3, requestId: "req-q-2",
    }).success).toBe(false);
    for (const duplicateQuestions of [
      [question, { ...question, order: 2 }],
      [question, { ...question, questionId: "question-2" }],
      [{ ...question, questionId: "" }],
      [{ ...question, order: 0 }],
    ]) {
      expect(operations.confirmDigitalInterviewQuestions.in.safeParse({
        interviewId: "itv-1", questions: duplicateQuestions, expectedVersion: 3, requestId: "req-q-3",
      }).success).toBe(false);
    }
    expect(operations.appendDigitalInterviewSkillMessage.in.safeParse({
      interviewId: "itv-1", currentStep: "invalid", text: "   ", expectedVersion: 3, requestId: "req-skill-2",
    }).success).toBe(false);
  });

  it("Skill lifecycle response rejects malformed lifecycle data and keeps the canonical replay error", () => {
    const complete = DigitalInterviewWorkflowView.parse(workflow());
    expect(complete.skillProposals.map((proposal) => proposal.status)).toEqual([
      "proposed", "applied_to_draft", "rejected", "committed", "stale",
    ]);
    expect(DigitalInterviewWorkflowView.safeParse({
      ...complete,
      skillMessages: [{ ...complete.skillMessages[0], unknown: true }],
    }).success).toBe(false);
    expect(DigitalInterviewWorkflowView.safeParse({
      ...complete,
      skillProposals: [{ ...complete.skillProposals[0], unknown: true }],
    }).success).toBe(false);
    const malformed = {
      ...workflow(),
      skillProposals: [{
        proposalId: "proposal-invalid", sourceMessageId: "message-1", targetStep: "questions",
        baseRevisionId: "rev-1", patch: {}, status: "applied_to_draft",
        createdAt: "2026-08-15T10:00:00.000Z", appliedAt: null, rejectedAt: null, committedVersionId: null,
      }],
    };
    expect(DigitalInterviewWorkflowView.safeParse(malformed).success).toBe(false);
    expect(InterviewError.options).toContain("IDEMPOTENCY_KEY_REUSED");
    expect(InterviewError.options).not.toContain("REQUEST_REPLAY_MISMATCH");
  });

  it("workflow 严格包含 scope、服务端候选与问题草稿，历史行复用已确认 topic", () => {
    const parsed = DigitalInterviewWorkflowView.parse(workflow());
    expect(parsed.scope).toEqual(scope);
    expect(parsed.expertCandidates[0]).toMatchObject({
      expertId: "expert-1", agentDefinitionId: "agent-definition-1", agentVersion: "agent-version-1",
      materialContextPackId: "context-pack-1", materialVersion: "material-v1",
    });
    expect(DigitalInterviewWorkflowView.safeParse({
      ...workflow(),
      expertCandidates: workflow().expertCandidates.map(({ agentVersion: _omitted, ...candidate }) => candidate),
    }).success).toBe(false);
    expect(parsed.questionCandidates).toEqual([question]);
    expect(operations.listDigitalInterviews.out.parse({
      items: [{
        interviewId: "itv-1", name: "采购", tags: ["采购"], topic: "谁有否决权", kind: "batch",
        status: "experts_pending", expertCount: 0, completedExpertCount: 0,
        primaryAction: "confirm_experts", updatedAt: "2026-08-15T10:00:00.000Z",
      }],
    }).items[0]?.topic).toBe("谁有否决权");
  });

  it("Skill 草稿上下文必须与当前步骤一致且保持严格结构", () => {
    const base = {
      interviewId: "itv-1", currentStep: "topic" as const, text: "聚焦否决权",
      expectedVersion: 3, requestId: "req-skill-context",
    };
    expect(operations.appendDigitalInterviewSkillMessage.in.parse({
      ...base, draftContext: { step: "topic", topic: "本地未确认主题" },
    }).draftContext).toEqual({ step: "topic", topic: "本地未确认主题" });
    expect(operations.appendDigitalInterviewSkillMessage.in.safeParse({
      ...base, draftContext: { step: "experts", expertIds: ["expert-1"] },
    }).success).toBe(false);
    expect(operations.appendDigitalInterviewSkillMessage.in.safeParse({
      ...base, draftContext: { step: "topic", topic: "草稿", unknown: true },
    }).success).toBe(false);
  });
});
