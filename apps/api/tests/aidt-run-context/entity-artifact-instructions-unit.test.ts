import { expect, it } from "vitest";
import { aidtEntityArtifactInstructions } from "../../src/application/aidt-run-context/entity-artifact-instructions";

it("binds ideation to the saved current activity and waits for student input before generating candidate drafts", () => {
  const instructions = aidtEntityArtifactInstructions("aidt-ideate");
  expect(instructions).toContain("brainstorm.activity.methodKey");
  expect(instructions).toContain("activity.methodGuide.startPrompt");
  expect(instructions).toContain("activity.methodGuide.description");
  expect(instructions).toContain("尚无学生点子或活动材料时，不输出 aidt-ideas");
  expect(instructions).toContain("不自动分类、投票或选择");
  expect(instructions).toContain("不默认自由联想");
  expect(instructions).toContain("sessionId 只取当前 entityId");
  expect(instructions).toContain("仅使用实际已有的聊天和上传能力");
  expect(instructions).toContain("不宣称系统新增匿名收集或实时协作");
  expect(instructions).toContain("角色假设与类比不是实地证据");
  expect(instructions).not.toContain("自由联想由关键词快速延伸；逆向思考");
});
it("preserves non-ideation artifact instructions and does not enable unknown skills", () => {
  expect(aidtEntityArtifactInstructions("aidt-empathize")).toContain("aidt-interview-guide");
  expect(aidtEntityArtifactInstructions("aidt-prototype")).toContain("verificationQuestion");
  expect(aidtEntityArtifactInstructions("unknown-skill")).toBe("");
});
