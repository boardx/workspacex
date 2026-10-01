import { describe, expect, it } from "vitest";
import { goalFromTriggerInput } from "../../src/application/workflow/trigger-goal";

describe("goalFromTriggerInput", () => {
  it("prefers goal-like keys, then any string; null when no text", () => {
    expect(goalFromTriggerInput({ projectId: "p1", goal: "提升留存" })).toBe("提升留存");
    expect(goalFromTriggerInput({ n: 3, other: "  随便一句 " })).toBe("随便一句");
    expect(goalFromTriggerInput({ n: 3 })).toBeNull();
    expect(goalFromTriggerInput(undefined)).toBeNull();
    expect(goalFromTriggerInput([])).toBeNull();
  });
  it("uses the first line and truncates at a clause boundary", () => {
    const long = `${"为了降低新用户在第一周的流失率，".repeat(1)}我们需要梳理注册到首次成功使用之间的全部关键路径，并且找出每一步的主要阻塞点，以及对应的改进方案和优先级排序，最后形成一份可以直接评审的产品需求文档`;
    const g = goalFromTriggerInput({ goal: `${long}\n第二行` })!;
    expect(g.endsWith("…")).toBe(true);
    expect(g.length).toBeLessThanOrEqual(81);
    expect(g).not.toContain("第二行");
    expect(g).toMatch(/[\u4e00-\u9fa5]…$/);
  });
});
