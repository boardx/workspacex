/**
 * 回环模型（仅 e2e / 本地原生栈）—— 内容线 Skill 阶段请求的确定性回复。
 *
 * `ModelContentSkillRunner` 要求模型**只回一个 JSON 对象**；通用回显 `[loopback] <user JSON>`
 * 不是 JSON，W029 frame 阶段因此必然 `skill_output_not_json_object`。这里按 runner 自己的
 * system prompt 约定行（`CONTENT_SKILL_REPLY_INSTRUCTION`，唯一事实源）识别请求，回一个
 * **同时满足 W029 全部阶段产出契约**的对象（frame / prioritize / draft·revise / kpi 的字段并集，
 * zod 对象默认放行多余字段），装配 PRD 时每个阶段都能取到合法形状。
 * 生产路径不引用本文件。
 */
import { CONTENT_SKILL_REPLY_INSTRUCTION } from "../src/application/work-content/content-skill-runner";

export function isContentSkillRequest(system: unknown): boolean {
  return typeof system === "string" && system.startsWith("Workflow ") && system.includes(CONTENT_SKILL_REPLY_INSTRUCTION);
}

export function contentSkillReply(userText: string): string {
  let stageId = "stage";
  let skill = "skill";
  try {
    const u = JSON.parse(userText) as { stageId?: unknown; skill?: unknown };
    if (typeof u.stageId === "string" && u.stageId) stageId = u.stageId;
    if (typeof u.skill === "string" && u.skill) skill = u.skill;
  } catch {
    /* 非 JSON 用户消息：仍回合法形状 */
  }
  return JSON.stringify({
    loopback: true,
    stageId,
    skill,
    problemStatement: `[loopback] ${stageId} problem statement`,
    evidenceRefs: [`loopback:${stageId}`],
    confidence: "medium",
    ranking: [{ id: "R1", priority: "P0" }],
    title: `[loopback] PRD (${stageId})`,
    requirements: [{ id: "R1", text: `[loopback] requirement from ${skill}` }],
    kpis: [{ name: "loopback_metric", definition: "[loopback] deterministic metric" }],
  });
}
