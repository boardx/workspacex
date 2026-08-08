/**
 * #725 -- `buildToolDefinitions`/`indexSkillsByToolName`. Pure functions, no I/O: see
 * `tool-definitions.ts`'s own header for why a Skill's whole body never appears here.
 */
import { describe, expect, it } from "vitest";
import {
  buildToolDefinitions, indexSkillsByToolName, type SkillForTool,
} from "../../src/application/agent-run/tool-definitions";

function skill(overrides: Partial<SkillForTool> = {}): SkillForTool {
  return {
    versionId: "version-1",
    content: "# SKILL.md body",
    stableName: "web-design-engineer",
    name: "Web Design Engineer",
    ...overrides,
  };
}

describe("buildToolDefinitions", () => {
  it("一个技能一个工具，工具名就是技能的 stableName，且不携带技能全文", () => {
    const tools = buildToolDefinitions([skill()]);
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("web-design-engineer");
    expect(tools[0]!.description).not.toContain("# SKILL.md body");
    expect(tools[0]!.description).toContain("Web Design Engineer");
  });

  it("参数 schema 只有一个必填的 task 字符串字段——技能是自由文本，不是带类型的 API", () => {
    const [tool] = buildToolDefinitions([skill()]);
    expect(tool!.parametersSchema).toEqual({
      type: "object",
      properties: { task: { type: "string", description: expect.any(String) } },
      required: ["task"],
      additionalProperties: false,
    });
  });

  it("保持传入顺序——顺序是快照钉住的事实，不是可以重排的集合", () => {
    const tools = buildToolDefinitions([
      skill({ stableName: "a-skill", name: "A" }),
      skill({ stableName: "b-skill", name: "B" }),
    ]);
    expect(tools.map((t) => t.name)).toEqual(["a-skill", "b-skill"]);
  });

  it("零个技能 ⇒ 零个工具", () => {
    expect(buildToolDefinitions([])).toEqual([]);
  });
});

describe("indexSkillsByToolName", () => {
  it("按工具名（=stableName）能查回对应的技能", () => {
    const s = skill({ stableName: "gpt-image-2", name: "GPT Image 2" });
    const byName = indexSkillsByToolName([s]);
    expect(byName.get("gpt-image-2")).toBe(s);
    expect(byName.get("no-such-tool")).toBeUndefined();
  });
});
