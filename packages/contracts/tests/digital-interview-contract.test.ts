import { describe, expect, it } from "vitest";
import {
  DigitalInterview,
  DigitalInterviewDraftInput,
  DigitalInterviewStatus,
  operations,
} from "../src/interview";

describe("数字专家访谈契约", () => {
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

  it("草稿必须同时包含非空名称、至少一个标签和非空主题", () => {
    expect(
      DigitalInterviewDraftInput.parse({
        name: " 德国采购决策链 ",
        tags: [" 采购决策 "],
        topic: " 储能采购的否决权归属 ",
      }),
    ).toEqual({
      name: "德国采购决策链",
      tags: ["采购决策"],
      topic: "储能采购的否决权归属",
    });

    for (const invalid of [
      { name: "", tags: ["采购"], topic: "决策链" },
      { name: "采购决策链", tags: [], topic: "决策链" },
      { name: "采购决策链", tags: ["采购"], topic: "   " },
    ]) {
      expect(DigitalInterviewDraftInput.safeParse(invalid).success).toBe(false);
    }
  });

  it("草稿创建响应携带唯一状态字段和可恢复版本", () => {
    const created = operations.createDigitalInterviewDraft.out.parse({
      interviewId: "itv-digital-1",
      name: "德国采购决策链",
      tags: ["采购决策"],
      topic: "储能采购的否决权归属",
      status: "draft",
      sourceQuickInterviewId: null,
      selectedExpertIds: [],
      reportId: null,
      version: 1,
    });

    expect(DigitalInterview.parse(created)).toEqual(created);
    expect(Object.keys(created).filter((key) => key.toLowerCase().includes("status"))).toEqual(["status"]);
  });
});
