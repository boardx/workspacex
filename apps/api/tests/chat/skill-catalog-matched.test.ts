/** #3749 B3: in matched mode only skills whose name/summary overlap the message are listed. */
import { describe, expect, it } from "vitest";
import { buildSkillCatalogHint, selectCatalogSkills, skillCatalogModeFromEnv } from "../../src/application/agent-run/skill-catalog";

const sk = (stableName: string, description: string) => ({ stableName, content: `---\nname: ${stableName}\ndescription: ${description}\n---\n# ${stableName}` });
const S = [sk("pptx-create", "生成演示文稿 PowerPoint 文件"), sk("web-research", "联网查证并形成带引用的研究报告"), sk("meeting-minutes", "把会议转录整理成决策与行动项"), sk("data-analysis", "分析 CSV XLSX 数据形成结论")];

describe("selectCatalogSkills", () => {
  it("all: unchanged", () => { expect(selectCatalogSkills(S, { mode: "all", text: "x" })).toHaveLength(4); });
  it("matched: the relevant ones first, unrelated ones dropped", () => {
    const got = selectCatalogSkills(S, { mode: "matched", text: "帮我把这段会议转录整理成会议纪要", max: 8 }).map((s) => s.stableName);
    expect(got[0]).toBe("meeting-minutes");
    expect(got).not.toContain("pptx-create");
  });
  it("matched: nothing overlaps → empty, and the hint still points at list_org_skills", () => {
    expect(selectCatalogSkills(S, { mode: "matched", text: "你好" })).toEqual([]);
    expect(buildSkillCatalogHint(4)).toContain("list_org_skills");
  });
  it("max caps the list", () => {
    expect(selectCatalogSkills(S, { mode: "matched", text: "演示文稿 研究报告 会议转录 数据分析", max: 2 })).toHaveLength(2);
  });
  it("mode and max come from env with safe defaults", () => {
    expect(skillCatalogModeFromEnv({} as NodeJS.ProcessEnv)).toEqual({ mode: "all", max: 8 });
    expect(skillCatalogModeFromEnv({ KERNEL_SKILL_CATALOG_MODE: "matched", KERNEL_SKILL_CATALOG_MAX: "3" } as NodeJS.ProcessEnv)).toEqual({ mode: "matched", max: 3 });
  });
});
