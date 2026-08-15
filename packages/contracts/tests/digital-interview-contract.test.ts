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

  it("只接受签核的八个工作流状态", () => {
    expect(DigitalInterviewStatus.options).toEqual([
      "draft",
      "topic_pending",
      "experts_pending",
      "questions_pending",
      "running",
      "report_pending",
      "completed",
      "failed",
    ]);
    expect(DigitalInterviewStatus.safeParse("scheduled").success).toBe(false);
  });

  it("草稿只保存非空名称和至少一个标签，主题留待显式确认", () => {
    expect(
      DigitalInterviewDraftInput.parse({
        name: " 德国采购决策链 ",
        tags: [" 采购决策 "],
      }),
    ).toEqual({
      name: "德国采购决策链",
      tags: ["采购决策"],
    });

    for (const invalid of [
      { name: "", tags: ["采购"] },
      { name: "采购决策链", tags: [] },
      { name: "采购决策链", tags: ["采购"], topic: "不应在创建时写入" },
    ]) {
      expect(DigitalInterviewDraftInput.safeParse(invalid).success).toBe(false);
    }
  });

  it("草稿创建输入不含主题，并以可恢复工作流视图响应", () => {
    const input = operations.createDigitalInterviewDraft.in.parse({
      name: "采购决策链",
      tags: ["采购"],
      scope,
      requestId: "req-create-1",
    });

    expect(input).not.toHaveProperty("topic");

    const created = operations.createDigitalInterviewDraft.out.parse({
      interviewId: "itv-digital-1",
      name: "德国采购决策链",
      tags: ["采购决策"],
      topic: null,
      status: "topic_pending",
      currentStep: "topic",
      sourceQuickInterviewId: null,
      selectedExpertIds: [],
      questions: [],
      reportId: null,
      version: 1,
      revisionId: "rev-1",
      topicVersionId: null,
      expertSnapshotVersionId: null,
      questionVersionId: null,
      skillThreadId: "skill-thread-1",
      activeAppliedSkillProposals: [],
    });

    expect(DigitalInterviewWorkflowView.parse(created)).toEqual(created);
    expect(Object.keys(created).filter((key) => key.toLowerCase().includes("status"))).toEqual(["status"]);
  });

  it("确认步骤要求版本、请求键和有效的确认数据", () => {
    expect(operations.confirmDigitalInterviewTopic.in.parse({
      interviewId: "itv-1",
      topic: "谁拥有否决权",
      expectedVersion: 1,
      requestId: "req-topic-1",
    })).toMatchObject({ expectedVersion: 1 });

    expect(() => operations.confirmDigitalInterviewQuestions.in.parse({
      interviewId: "itv-1",
      questions: [],
      expectedVersion: 3,
      requestId: "req-q-1",
    })).toThrow();
  });

  it("Skill 建议生命周期写入需要版本与请求键", () => {
    const skillMessage = operations.appendDigitalInterviewSkillMessage.in.parse({
      interviewId: "itv-1",
      currentStep: "questions",
      text: "补充每位专家的反例问题",
      expectedVersion: 3,
      requestId: "req-skill-message-1",
    });
    expect(skillMessage).toMatchObject({ currentStep: "questions", expectedVersion: 3 });

    const proposal = operations.applyDigitalInterviewSkillProposal.in.parse({
      interviewId: "itv-1",
      proposalId: "proposal-1",
      expectedVersion: 3,
      requestId: "req-skill-apply-1",
    });
    expect(proposal).toMatchObject({ proposalId: "proposal-1" });

    expect(operations.rejectDigitalInterviewSkillProposal.in.parse({
      interviewId: "itv-1",
      proposalId: "proposal-1",
      expectedVersion: 3,
      requestId: "req-skill-reject-1",
    })).toMatchObject({ expectedVersion: 3 });
    expect(InterviewError.options).toContain("IDEMPOTENCY_KEY_REUSED");
  });
});
