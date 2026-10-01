/**
 * 回环模型 × 内容线 Skill：`[loopback] <user JSON>` 通用回显让 W029 frame 阶段必然
 * `skill_output_not_json_object`。回环脚本按 runner 的 system 约定行识别请求、回满足 W029
 * 全部阶段契约的单个 JSON 对象；生产 runner 仍严格（前缀文本照旧拒绝）。
 */
import { describe, expect, it } from "vitest";
import { PrdDraftStageOutput, PrdFrameStageOutput, PrdKpiStageOutput, PrdPriorityStageOutput } from "@repo/contracts/work-content";
import { contentSkillReply, isContentSkillRequest } from "../../scripts/loopback-content-skill";
import { ContentSkillRunError, ModelContentSkillRunner } from "../../src/application/work-content/content-skill-runner";
import type { ModelCallPort } from "../../src/application/agent-run/ports";
import { assemblePrdArtifact, prdStageOutputsFrom } from "../../src/domain/work-content/prd-artifact";

const agents = { agentVersionModel: async () => ({ modelProvider: "dashscope", modelId: "m" }) };
const skills = { skillInstructions: async () => "# Problem Framing\nIdentify the problem and supporting evidence." };
const call = (stageId: string) => ({
  orgId: "o", instanceId: "i", agentVersionId: "av", workflowId: "W029", stageId, skillId: "S064", skillVersion: "1.0.0",
  input: { problem: "导入太难" }, prior: {},
});

/** 模拟回环脚本的分支：只有被识别为内容线 Skill 请求才回 JSON，否则走通用回显。 */
const loopbackPort = (seen: string[]): ModelCallPort => ({
  complete: async (req: { system: string; user: string }) => {
    seen.push(req.system);
    return { text: isContentSkillRequest(req.system) ? contentSkillReply(req.user) : `[loopback] ${req.user}` };
  },
}) as unknown as ModelCallPort;

describe("loopback content-skill reply", () => {
  it("recognises the runner's own stage prompt and returns one JSON object valid for every W029 stage contract", async () => {
    const seen: string[] = [];
    const out = await new ModelContentSkillRunner(loopbackPort(seen), agents, skills).run(call("frame"));
    expect(isContentSkillRequest(seen[0])).toBe(true);
    expect(out).toMatchObject({ loopback: true, stageId: "frame", skill: "S064@1.0.0" });
    for (const schema of [PrdFrameStageOutput, PrdPriorityStageOutput, PrdDraftStageOutput, PrdKpiStageOutput]) expect(schema.safeParse(out).success).toBe(true);
    const all = Object.fromEntries(["frame", "prioritize", "draft", "revise", "kpi"].map((k) => [k, out]));
    expect(assemblePrdArtifact(prdStageOutputsFrom(all)).problem.evidenceRefs).toEqual(["loopback:frame"]);
  });

  it("does not hijack ordinary chat / other system prompts", () => {
    expect(isContentSkillRequest("You are a helpful agent.")).toBe(false);
    expect(isContentSkillRequest(undefined)).toBe(false);
  });

  it("production runner stays strict: a prefixed echo is still skill_output_not_json_object", async () => {
    const echo = { complete: async (req: { user: string }) => ({ text: `[loopback] ${req.user}` }) } as unknown as ModelCallPort;
    await expect(new ModelContentSkillRunner(echo, agents, skills).run(call("frame"))).rejects.toMatchObject({
      name: "ContentSkillRunError", reason: "skill_output_not_json_object", code: "CONTENT_SKILL_OUTPUT_NOT_JSON_OBJECT",
    });
    await expect(new ModelContentSkillRunner(echo, agents, skills).run(call("frame"))).rejects.toBeInstanceOf(ContentSkillRunError);
  });
});
