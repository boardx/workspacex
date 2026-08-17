import { describe, expect, it } from "vitest";
import * as research from "../src/research";

const { operations } = research;

describe("F168 guided research session contract", () => {
  it("keeps the resumable stage and brief in the shared contract", () => {
    const created = operations.createGuidedResearchSession.out.parse({
      sessionId: "grs-1",
      title: "欧洲储能市场进入策略",
      tags: ["欧洲", "储能"],
      brief: {
        topic: "欧洲储能市场进入策略",
        goal: "确定首批进入国家",
        timeRange: "2025-2028",
        region: "欧洲",
        focus: "市场、政策和并网",
      },
      stage: "directions",
      resumeStage: "directions",
      status: "active",
      progress: 20,
      sourceCount: 0,
      reportId: null,
      createdAt: "2026-08-12T09:00:00.000Z",
      updatedAt: "2026-08-12T09:00:00.000Z",
    });

    expect(created.stage).toBe("directions");
    expect(created.tags).toEqual(["欧洲", "储能"]);
    expect(operations.listGuidedResearchSessions.path).toBe("/research/guided-sessions");
    expect(operations.getGuidedResearchSession.path).toContain(":sessionId");
  });

  it("rejects a client-authored owner, org, stage or progress", () => {
    const result = operations.createGuidedResearchSession.in.safeParse({
      idempotencyKey: "create-1",
      brief: {
        topic: "欧洲储能市场进入策略",
        goal: "确定首批进入国家",
        timeRange: "2025-2028",
        region: "欧洲",
        focus: "市场、政策和并网",
      },
      ownerId: "u-other",
      orgId: "org-other",
      stage: "report",
      progress: 100,
    });

    expect(result.success).toBe(false);
  });

  it("accepts only explicit collaborator user ids when a session is created", () => {
    const parsed = operations.createGuidedResearchSession.in.parse({
      title: "欧洲储能进入研究",
      tags: ["欧洲", "储能"],
      idempotencyKey: "create-shared",
      collaboratorUserIds: ["u-collaborator"],
      brief: {
        topic: "欧洲储能市场进入策略", goal: "确定首批进入国家",
        timeRange: "2025-2028", region: "欧洲", focus: "市场、政策和并网",
      },
    });
    expect(parsed.collaboratorUserIds).toEqual(["u-collaborator"]);
    expect(parsed.tags).toEqual(["欧洲", "储能"]);
    expect(operations.createGuidedResearchSession.in.safeParse({
      ...parsed, collaboratorUserIds: ["u-collaborator", "u-collaborator"],
    }).success).toBe(false);
  });
});

describe("F169 guided research human checkpoint contract", () => {
  const direction = {
    id: "direction-1", title: "市场规模", description: "验证市场规模与增长质量", enabled: true, order: 0,
  };
  const outline = {
    id: "section-1", title: "市场规模", questions: ["规模是多少？"], enabled: true, order: 0,
  };

  it("keeps candidate versions separate from the latest human-confirmed version", () => {
    const parsed = operations.getGuidedResearchSession.out.parse({
      sessionId: "grs-1", title: "欧洲储能", brief: {
        topic: "欧洲储能", goal: "选择进入市场", timeRange: "2025", region: "欧洲", focus: "规模",
      },
      briefVersion: 1, briefConfirmedAt: "2026-08-13T00:00:00.000Z",
      directions: {
        candidateVersion: 3, confirmedVersion: 2,
        versions: [
          { version: 2, items: [{ ...direction, title: "人工确认方向" }], createdAt: "2026-08-13T00:01:00.000Z", confirmedAt: "2026-08-13T00:02:00.000Z" },
          { version: 3, items: [{ ...direction, title: "新候选方向" }], createdAt: "2026-08-13T00:03:00.000Z", confirmedAt: null },
        ],
      },
      outline: { candidateVersion: null, confirmedVersion: null, versions: [] },
      stage: "directions", resumeStage: "directions", status: "active", progress: 20, sourceCount: 0,
      reportId: null, createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:03:00.000Z",
    });

    expect(parsed.directions.confirmedVersion).toBe(2);
    expect(parsed.directions.candidateVersion).toBe(3);
  });

  it("rejects all-disabled directions and empty outlines before confirmation", () => {
    expect(operations.confirmResearchDirections.in.safeParse({
      sessionId: "grs-1", candidateVersion: 1, directions: [{ ...direction, enabled: false }],
    }).success).toBe(false);
    expect(operations.confirmResearchOutline.in.safeParse({
      sessionId: "grs-1", candidateVersion: 1, outline: [{ ...outline, title: "   " }],
    }).success).toBe(false);
  });
});

describe("guided research post-outline lifecycle contract", () => {
  it("defines same-session brief reconfirmation", () => {
    const operation = operations.confirmResearchBrief;

    expect(operation).toMatchObject({
      method: "PUT",
      path: "/research/guided-sessions/:sessionId/brief",
    });
    expect(operation.err).toContain("RESEARCH_CHECKPOINT_CONFLICT");
  });

  it("declares every stage conflict returned by checkpoint controllers", () => {
    for (const operation of [
      operations.generateResearchDirections,
      operations.confirmResearchDirections,
      operations.generateResearchOutline,
      operations.confirmResearchOutline,
    ]) {
      expect(operation.err).toContain("RESEARCH_STAGE_CONFLICT");
    }
  });

  it("defines ordered collection and completion operations", () => {
    expect(research.operations.finishGuidedResearchCollection).toMatchObject({
      method: "POST",
      path: "/research/guided-sessions/:sessionId/researching/complete",
      err: ["RESEARCH_NOT_FOUND", "RESEARCH_STAGE_CONFLICT"],
    });
    expect(research.operations.completeGuidedResearchSession).toMatchObject({
      method: "POST",
      path: "/research/guided-sessions/:sessionId/complete",
      err: ["RESEARCH_NOT_FOUND", "RESEARCH_STAGE_CONFLICT"],
    });
    expect(research.operations.finishGuidedResearchCollection.in.parse({
      sessionId: "grs-1",
      sourceCount: 3,
    })).toEqual({ sessionId: "grs-1", sourceCount: 3 });
    expect(research.ResearchError.options).toContain("RESEARCH_STAGE_CONFLICT");
  });
});

describe("F195 guided research workflow command contract", () => {
  const commandBase = {
    sessionId: "grs-1",
    action: "confirm",
    requestId: "req-1",
    expectedGraphVersion: 3,
  } as const;

  const completeNodeStates = {
    brief: {
      name: "欧洲储能进入研究",
      tags: ["欧洲", "储能"],
      topic: "欧洲储能市场进入策略",
      objective: "确定首批进入国家",
      timeRange: "2025-2028",
      geography: "欧洲",
      focus: "市场、政策和并网",
    },
    directions: {
      directions: [{
        id: "direction-1",
        title: "市场规模",
        description: "验证市场规模与增长质量",
        enabled: true,
        order: 0,
      }],
    },
    outline: {
      sections: [{
        id: "section-1",
        title: "市场规模",
        description: "核验市场容量、增速和增长质量",
        researchQuestions: ["市场容量是多少？"],
        order: 0,
      }],
    },
    research: {
      acceptedSourceIds: ["source-1"],
      excludedSourceIds: ["source-2"],
    },
    report: {
      title: "欧洲储能市场进入策略研究报告",
      revisionInstruction: "补充执行摘要",
    },
  } as const;

  it("requires the complete current node state for every node command", () => {
    for (const [node, nodeState] of Object.entries(completeNodeStates)) {
      expect(research.GuidedResearchNodeCommand.parse({
        ...commandBase,
        node,
        nodeState,
      })).toMatchObject({ node, nodeState });
    }

    expect(research.GuidedResearchNodeCommand.safeParse({
      ...commandBase,
      node: "brief",
      nodeState: { ...completeNodeStates.brief, objective: undefined },
    }).success).toBe(false);
    expect(research.GuidedResearchNodeCommand.safeParse({
      ...commandBase,
      node: "brief",
      nodeState: completeNodeStates.brief,
      requestId: undefined,
    }).success).toBe(false);
    expect(research.GuidedResearchNodeCommand.safeParse({
      ...commandBase,
      node: "brief",
      nodeState: completeNodeStates.brief,
      expectedGraphVersion: undefined,
    }).success).toBe(false);
  });

  it("strictly validates workflow directions and outline node states", () => {
    expect(research.GuidedResearchNodeCommand.safeParse({
      ...commandBase,
      node: "directions",
      nodeState: {
        directions: [{ ...completeNodeStates.directions.directions[0], enabled: false }],
      },
    }).success).toBe(false);
    expect(research.GuidedResearchNodeCommand.safeParse({
      ...commandBase,
      node: "directions",
      nodeState: {
        directions: [
          completeNodeStates.directions.directions[0],
          { ...completeNodeStates.directions.directions[0], title: "重复 ID", order: 1 },
        ],
      },
    }).success).toBe(false);
    expect(research.GuidedResearchNodeCommand.safeParse({
      ...commandBase,
      node: "outline",
      nodeState: {
        sections: [
          completeNodeStates.outline.sections[0],
          { ...completeNodeStates.outline.sections[0], id: "section-2", order: 2 },
        ],
      },
    }).success).toBe(false);
  });

  it("keeps model generation response shapes in the shared contract", () => {
    expect(research.GuidedResearchDirectionGenerationResponse.parse({
      directions: completeNodeStates.directions.directions,
    })).toEqual(completeNodeStates.directions);
    expect(research.GuidedResearchDirectionGenerationResponse.safeParse({
      directions: [],
    }).success).toBe(false);

    expect(research.GuidedResearchOutlineGenerationResponse.parse({
      sections: completeNodeStates.outline.sections,
    })).toEqual(completeNodeStates.outline);
    expect(research.GuidedResearchOutlineGenerationResponse.safeParse({
      sections: [],
    }).success).toBe(false);
  });

  it("rejects server-authored graph metadata and unknown fields", () => {
    expect(research.GuidedResearchNodeCommand.safeParse({
      ...commandBase,
      node: "brief",
      nodeState: {
        ...completeNodeStates.brief,
        graphVersion: 99,
        modelId: "qwen3.7-plus",
      },
    }).success).toBe(false);
    expect(research.GuidedResearchNodeCommand.safeParse({
      ...commandBase,
      node: "brief",
      nodeState: completeNodeStates.brief,
      orgId: "org-other",
    }).success).toBe(false);
  });

  it("exposes one canonical workflow command route and closed workflow errors", () => {
    expect(operations.getGuidedResearchWorkflow).toMatchObject({
      method: "GET",
      path: "/research/guided-sessions/:sessionId/workflow",
    });
    expect(operations.getGuidedResearchNode).toMatchObject({
      method: "GET",
      path: "/research/guided-sessions/:sessionId/workflow/nodes/:node",
    });
    expect(operations.executeGuidedResearchNode).toMatchObject({
      method: "POST",
      path: "/research/guided-sessions/:sessionId/workflow/nodes/:node",
    });
    expect(operations.listGuidedResearchEvents.path).toBe(
      "/research/guided-sessions/:sessionId/workflow/events",
    );
    expect(operations.appendGuidedResearchSkillMessage.path).toBe(
      "/research/guided-sessions/:sessionId/skill/messages",
    );

    for (const code of [
      "RESEARCH_WORKFLOW_UNAVAILABLE",
      "RESEARCH_NODE_LOCKED",
      "RESEARCH_NODE_MISMATCH",
      "RESEARCH_GRAPH_VERSION_CONFLICT",
      "RESEARCH_NODE_STATE_INVALID",
      "RESEARCH_IDEMPOTENCY_REPLAY_MISMATCH",
      "RESEARCH_CONTENT_REFERENCE_INVALID",
      "RESEARCH_TASK_NOT_RETRYABLE",
    ]) {
      expect(research.ResearchError.options).toContain(code);
      expect(operations.executeGuidedResearchNode.err).toContain(code);
    }
  });

  it("treats generated directions as structured node state with qwen3.7-plus provenance", () => {
    const parsed = research.GuidedResearchWorkflowProjection.parse({
      sessionId: "grs-1",
      graphVersion: 2,
      revision: 2,
      currentNode: "directions",
      availableNodes: ["brief", "directions"],
      nodeSummaries: {
        brief: {
          status: "confirmed",
          version: 2,
          confirmedVersion: 2,
          contentVersionId: null,
          modelId: null,
          modelInvocationId: null,
          modelOutputSchemaVersion: null,
          confirmedAt: "2026-08-16T00:00:00.000Z",
          updatedAt: "2026-08-16T00:00:00.000Z",
          errorCode: null,
        },
        directions: {
          status: "ready",
          version: 1,
          confirmedVersion: null,
          contentVersionId: "sha256-direction-state",
          modelId: "qwen3.7-plus",
          modelInvocationId: "grs-1:req-1:directions:generate",
          modelOutputSchemaVersion: "guided-research-directions:v1",
          confirmedAt: null,
          updatedAt: "2026-08-16T00:00:01.000Z",
          errorCode: null,
        },
        outline: { status: "locked", version: 0, confirmedVersion: null, contentVersionId: null, modelId: null, modelInvocationId: null, modelOutputSchemaVersion: null, confirmedAt: null, updatedAt: "2026-08-16T00:00:00.000Z", errorCode: null },
        research: { status: "locked", version: 0, confirmedVersion: null, contentVersionId: null, modelId: null, modelInvocationId: null, modelOutputSchemaVersion: null, confirmedAt: null, updatedAt: "2026-08-16T00:00:00.000Z", errorCode: null },
        report: { status: "locked", version: 0, confirmedVersion: null, contentVersionId: null, modelId: null, modelInvocationId: null, modelOutputSchemaVersion: null, confirmedAt: null, updatedAt: "2026-08-16T00:00:00.000Z", errorCode: null },
      },
      activeNodeState: completeNodeStates.directions,
      nodeStateVersions: { brief: 2, directions: 1 },
      skill: {
        threadId: "grs-1",
        activeNode: "directions",
        summaryId: null,
        recentMessageIds: [],
        activeProposalId: null,
        proposalStatus: "none",
      },
      interrupt: { node: "directions", allowedActions: ["save", "generate", "confirm", "reconfirm"] },
    });

    expect(parsed.activeNodeState).toEqual(completeNodeStates.directions);
    expect(parsed.nodeSummaries.directions.modelId).toBe("qwen3.7-plus");
  });
});
