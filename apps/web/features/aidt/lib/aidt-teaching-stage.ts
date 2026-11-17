import { AIDT_STEPS, type AidtStep } from "./project-aidt";

/** Explicit course coordinates; UI guidance is neither evidence nor permission authority. */
export function aidtTeachingStage(step: AidtStep) {
  return {
    course: "AIDT",
    stageCount: AIDT_STEPS.length,
    stageTitle: step.title,
    stageTask: step.task,
    stageOutcome: step.outcome,
    courseStages: AIDT_STEPS.map(stage => ({ step: stage.id, title: stage.title, skillStableName: stage.skill })),
    stageModelRule: "本课程按所列六步及当前已挂载Skill理解阶段。第1步是理解与提出问题，第2步才是共情用户；不按通用五阶段设计思维重排编号。步骤描述不代表学生已完成、研究已验证或工具已获授权。",
  };
}
