import { describe, expect, it } from "vitest";
import { stageFailureKindText } from "../components/workflow/workflow-copy";

describe("stage failure kind copy", () => {
  it("skill_output_invalid (Skill 阶段模型回复不是约定的 JSON 对象) has friendly copy without internal codes", () => {
    const text = stageFailureKindText("skill_output_invalid");
    expect(text).toBe("模型返回的内容格式不符合要求，请稍后重新发起");
    expect(text).not.toMatch(/json|skill_output|CONTENT_SKILL/i);
  });
  it("unknown kinds are not shown", () => {
    expect(stageFailureKindText("nope")).toBeNull();
  });
});
