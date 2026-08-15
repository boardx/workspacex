import { Command, MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { createDigitalInterviewGraph } from "../../src/application/interview/workflow/digital-interview-graph";
import type {
  CommitDigitalInterviewStepInput,
  CommitDigitalInterviewStepResult,
  DigitalInterviewEffects,
} from "../../src/application/interview/workflow/digital-interview-effects.port";
import { initialDigitalInterviewState } from "../../src/application/interview/workflow/digital-interview-state";

const config = {
  configurable: {
    thread_id: "itv-graph-f04",
    checkpoint_ns: "digital-interview:v1",
  },
};

function createEffects(): DigitalInterviewEffects {
  return {
    commitStep: vi.fn(async (input: CommitDigitalInterviewStepInput): Promise<CommitDigitalInterviewStepResult> => ({
      interviewId: input.interviewId,
      revisionId: "revision-f04-1",
      revisionNumber: 1,
      currentStep: input.nodeName === "confirm_topic"
        ? "experts"
        : input.nodeName === "confirm_experts"
          ? "questions"
          : "runs",
      topicVersionId: input.nodeName === "confirm_topic" ? "topic-v1" : "topic-v1",
      expertSnapshotVersionId: input.nodeName === "confirm_experts" ? "experts-v1" : null,
      questionVersionId: input.nodeName === "confirm_questions" ? "questions-v1" : null,
      skillThreadId: "skill-thread-f04",
      operationId: input.operationId,
      requestId: input.command.requestId,
      aggregateVersion: input.command.expectedVersion + 1,
    })),
    createDraft: vi.fn(async () => { throw new Error("not used by graph nodes"); }),
    findReceipt: vi.fn(async () => { throw new Error("not used by graph nodes"); }),
    appendSkillMessage: vi.fn(async () => { throw new Error("not used by graph nodes"); }),
    setSkillProposalStatus: vi.fn(async () => { throw new Error("not used by graph nodes"); }),
    generateExpertCandidates: vi.fn(async () => undefined),
    generateQuestions: vi.fn(async () => undefined),
  };
}

function interrupts(value: unknown): unknown {
  return (value as { readonly __interrupt__?: unknown }).__interrupt__;
}

describe("F04 digital interview LangGraph", () => {
  it("interrupts at every human confirmation and follows the setup transition chain", async () => {
    const effects = createEffects();
    const graph = createDigitalInterviewGraph({ effects, checkpointer: new MemorySaver() });
    const initial = initialDigitalInterviewState({
      interviewId: "itv-graph-f04",
      orgId: "org-graph-f04",
      actorId: "user-graph-f04",
      revisionId: "revision-f04-1",
      revisionNumber: 1,
      skillThreadId: "skill-thread-f04",
    });

    const topicInterrupt = await graph.invoke(initial, config);
    expect(interrupts(topicInterrupt)).toMatchObject([{ value: { nodeName: "confirm_topic" } }]);

    const expertInterrupt = await graph.invoke(new Command({ resume: {
      kind: "confirm_topic",
      topic: "谁拥有最终否决权？",
      expectedVersion: 1,
      requestId: "req-topic-graph-f04",
    } }), config);
    expect(expertInterrupt).toMatchObject({
      currentStep: "experts",
      topicVersionId: "topic-v1",
      __interrupt__: [{ value: { nodeName: "confirm_experts" } }],
    });

    const questionInterrupt = await graph.invoke(new Command({ resume: {
      kind: "confirm_experts",
      expertIds: ["expert-f04"],
      expectedVersion: 2,
      requestId: "req-experts-graph-f04",
    } }), config);
    expect(questionInterrupt).toMatchObject({
      currentStep: "questions",
      expertSnapshotVersionId: "experts-v1",
      __interrupt__: [{ value: { nodeName: "confirm_questions" } }],
    });

    const completed = await graph.invoke(new Command({ resume: {
      kind: "confirm_questions",
      questions: [{
        questionId: "question-f04",
        expertId: "expert-f04",
        order: 1,
        text: "谁参与评审？",
        purpose: "识别决策角色",
      }],
      expectedVersion: 3,
      requestId: "req-questions-graph-f04",
    } }), config);
    expect(completed).toMatchObject({ currentStep: "runs", questionVersionId: "questions-v1" });
    expect(interrupts(completed)).toBeUndefined();

    expect(effects.commitStep).toHaveBeenCalledTimes(3);
    expect(effects.generateExpertCandidates).toHaveBeenCalledWith({
      orgId: "org-graph-f04", actorId: "user-graph-f04", interviewId: "itv-graph-f04",
      revisionId: "revision-f04-1", revisionNumber: 1, expectedVersion: 2,
      requestId: "req-topic-graph-f04",
      operationId: "itv-graph-f04:generate_expert_candidates:1:req-topic-graph-f04",
    });
    expect(effects.generateQuestions).toHaveBeenCalledWith({
      orgId: "org-graph-f04", actorId: "user-graph-f04", interviewId: "itv-graph-f04",
      revisionId: "revision-f04-1", revisionNumber: 1, expectedVersion: 3,
      requestId: "req-experts-graph-f04",
      operationId: "itv-graph-f04:generate_questions:1:req-experts-graph-f04",
    });
    expect(vi.mocked(effects.commitStep).mock.calls.map(([input]) => input.operationId)).toEqual([
      "itv-graph-f04:confirm_topic:1:req-topic-graph-f04",
      "itv-graph-f04:confirm_experts:1:req-experts-graph-f04",
      "itv-graph-f04:confirm_questions:1:req-questions-graph-f04",
    ]);
  });

  it("returns Skill refinement to its origin without changing confirmed version identifiers", async () => {
    const effects = createEffects();
    const graph = createDigitalInterviewGraph({ effects, checkpointer: new MemorySaver() });
    const initial = initialDigitalInterviewState({
      interviewId: "itv-skill-graph-f04",
      orgId: "org-graph-f04",
      actorId: "user-graph-f04",
      revisionId: "revision-f04-1",
      revisionNumber: 1,
      skillThreadId: "skill-thread-f04",
      currentStep: "questions",
      topicVersionId: "topic-v1",
      expertSnapshotVersionId: "experts-v1",
      questionVersionId: "questions-v1",
    });

    const result = await graph.invoke({ ...initial, command: {
      kind: "skill_refine",
      originStep: "questions",
      expectedVersion: 4,
      requestId: "req-skill-graph-f04",
    } }, {
      configurable: {
        thread_id: "itv-skill-graph-f04",
        checkpoint_ns: "digital-interview:v1",
      },
    });

    expect(result).toMatchObject({
      currentStep: "questions",
      topicVersionId: "topic-v1",
      expertSnapshotVersionId: "experts-v1",
      questionVersionId: "questions-v1",
    });
  });

  it("re-enters an upstream confirmation from a completed setup checkpoint", async () => {
    const effects = createEffects();
    const graph = createDigitalInterviewGraph({ effects, checkpointer: new MemorySaver() });
    const initial = initialDigitalInterviewState({
      interviewId: "itv-graph-f04", orgId: "org-graph-f04", actorId: "original-actor",
      revisionId: "revision-f04-1", revisionNumber: 1, skillThreadId: "skill-thread-f04",
    });
    await graph.invoke(initial, config);
    await graph.invoke(new Command({ resume: {
      kind: "confirm_topic", topic: "旧主题", expectedVersion: 1, requestId: "topic-first",
    } }), config);
    await graph.invoke(new Command({ resume: {
      kind: "confirm_experts", expertIds: ["expert-f04"], expectedVersion: 2, requestId: "experts-first",
    } }), config);
    await graph.invoke(new Command({ resume: {
      kind: "confirm_questions", questions: [{ questionId: "q-first", expertId: "expert-f04",
        order: 1, text: "旧问题", purpose: "旧目的" }], expectedVersion: 3, requestId: "questions-first",
    } }), config);

    await graph.invoke(new Command({
      update: { currentStep: "topic", actorId: "current-actor" },
      goto: "confirm_topic",
    }), config);
    const revised = await graph.invoke(new Command({ update: { actorId: "current-actor" }, resume: {
      kind: "confirm_topic", topic: "新主题", expectedVersion: 4, requestId: "topic-reconfirm",
    } }), config);

    expect(revised).toMatchObject({ currentStep: "experts" });
    expect(effects.commitStep).toHaveBeenLastCalledWith(expect.objectContaining({
      actorId: "current-actor", nodeName: "confirm_topic",
      command: expect.objectContaining({ requestId: "topic-reconfirm" }),
    }));
    expect(effects.generateExpertCandidates).toHaveBeenCalledTimes(2);
  });
});
