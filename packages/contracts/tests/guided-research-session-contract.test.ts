import { describe, expect, it } from "vitest";
import { operations } from "../src/research";

describe("F168 guided research session contract", () => {
  it("keeps the resumable stage and brief in the shared contract", () => {
    const created = operations.createGuidedResearchSession.out.parse({
      sessionId: "grs-1",
      title: "欧洲储能市场进入策略",
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
});
