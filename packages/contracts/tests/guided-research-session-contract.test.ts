import { describe, expect, it } from "vitest";
import { operations } from "../src/research";

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
