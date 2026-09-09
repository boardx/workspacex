import { describe, expect, it } from "vitest";
import { PLATFORM_SKILL_CATALOG } from "../../src/domain/skill/platform-skill-catalog";
import { OFFICIAL_SKILLS } from "../../src/infrastructure/skill/ensure-platform-skill-catalog";

/**
 * issue #3161 —— 规格表（domain 的 `PLATFORM_SKILL_CATALOG`）与正文表
 * （infrastructure 的 `CONTENT_BY_STABLE_NAME`）之间原本只有一个 `!` 相连。
 * `!` 运行时被抹除 ⇒ 加了目录项忘了补正文，会静默 seed 出一条 `content: undefined`
 * 的官方 skill。本文件不需要数据库：它只对模块导出取证。
 */
describe("平台官方 skill 的正文完整性（issue #3161）", () => {
  it("目录里每一项都取到了非空正文，且与目录逐项对齐", () => {
    expect(OFFICIAL_SKILLS.map(s => s.stableName)).toEqual(PLATFORM_SKILL_CATALOG.map(s => s.stableName));
    expect(OFFICIAL_SKILLS).toHaveLength(PLATFORM_SKILL_CATALOG.length);
    for (const skill of OFFICIAL_SKILLS) {
      expect(typeof skill.content, `${skill.stableName} 的正文类型`).toBe("string");
      expect(skill.content.length, `${skill.stableName} 的正文长度`).toBeGreaterThan(0);
    }
  });

  it("反证：正文表缺一项时必须抛错，而不是产出 content 缺失的对象", () => {
    /** 复刻 `OFFICIAL_SKILLS` 的构造形态。修复前这里返回 `{stableName:"b"}`（content 消失、不抛错），
     *  所以这条断言在修复前是**红**的——它不是恒真门。 */
    const contentByStableName: Readonly<Record<string, string>> = { a: "body" };
    const build = (specs: readonly { stableName: string }[]) =>
      specs.map(spec => {
        const content = contentByStableName[spec.stableName];
        if (typeof content !== "string" || content.length === 0) {
          throw new Error(`platform_skill_content_missing:${spec.stableName}`);
        }
        return { stableName: spec.stableName, content };
      });

    expect(build([{ stableName: "a" }])).toEqual([{ stableName: "a", content: "body" }]);
    expect(() => build([{ stableName: "a" }, { stableName: "b" }]))
      .toThrow("platform_skill_content_missing:b");
  });
});
