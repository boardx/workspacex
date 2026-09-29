/**
 * CT06 —— 内容线阶段内执行一个已固定版本 Skill 的端口（ADR-118 #9：版本来自实例冻结的 pinnedSkills）。
 * 生产实现接 Agent 运行时；e2e 用回环模型实现（UC-WC-I5）。`prior` 是本实例此前各 Skill 阶段的产出。
 */
export interface ContentSkillInvocation {
  orgId: string;
  instanceId: string;
  workflowId: string;
  stageId: string;
  skillId: string;
  skillVersion: string;
  input: Record<string, unknown>;
  prior: Readonly<Record<string, unknown>>;
}

export interface ContentSkillRunnerPort {
  run(call: ContentSkillInvocation): Promise<Record<string, unknown>>;
}
