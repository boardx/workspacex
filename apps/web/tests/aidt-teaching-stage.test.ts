import { expect, it } from "vitest";
import { AIDT_STEPS } from "@/features/aidt/lib/project-aidt";
import { aidtTeachingStage } from "@/features/aidt/lib/aidt-teaching-stage";

it("keeps AIDT understand and empathize as distinct first and second stages", () => {
  const first=aidtTeachingStage(AIDT_STEPS[0]);
  expect(first.stageCount).toBe(6);
  expect(first.stageTitle).toBe("理解与提出问题");
  expect(first.courseStages.slice(0,2)).toEqual([
    {step:1,title:"理解与提出问题",skillStableName:"aidt-understand"},
    {step:2,title:"共情用户",skillStableName:"aidt-empathize"},
  ]);
  expect(first.stageModelRule).toContain("不按通用五阶段设计思维重排编号");
  expect(aidtTeachingStage(AIDT_STEPS[1]).stageTitle).toBe("共情用户");
});
it("sends the actual current task and expected outcome, without introducing a seventh stage", () => {
  for(const stage of AIDT_STEPS) {
    const value=aidtTeachingStage(stage);
    expect(value.stageTask).toBe(stage.task);
    expect(value.stageOutcome).toBe(stage.outcome);
    expect(value.courseStages).toHaveLength(6);
    expect(value.courseStages.at(-1)).toMatchObject({step:6,skillStableName:"aidt-iterate"});
  }
});
