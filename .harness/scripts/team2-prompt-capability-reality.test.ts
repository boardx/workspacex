/**
 * 任务书只许依赖**真实存在**的能力。
 *
 * 2026-09-15 实测发现的功能性 bug：任务书第三步写着「用 `data-analysis` skill 的沙箱脚本
 * 计算」，而 `data-analysis` 不在 `PLATFORM_SKILL_CATALOG`——平台级默认可见的只有
 * pptx/docx/xlsx/pdf-create 四个。`skills/data-workflows/data-analysis/` 这个包在仓库里
 * 存在，但要本组织导入并启用后才会进 run 的 skill 列表。
 *
 * 为什么这条特别要命：让模型去找一个不存在的 skill，最可能的退化**不是报错，是它绕过
 * 沙箱直接心算**——而「算分必须由脚本真实执行、模型不得心算」是这个 Agent 唯一不可
 * 妥协的规则（R7 业务规则 2）。任务书自己把那条规则的地基抽掉了，而且不会有任何东西变红。
 *
 * 所以这里机械核对：任务书里以「用 X skill」形式提出的**硬要求**，X 必须在平台目录里；
 * 非平台能力只能以「有就更好，没有也必须照做」的形式出现。
 */
import { describe, expect, it } from "vitest";
import { buildRatingPrompt } from "../../apps/web/lib/postinvest-rating/rating-prompt";
import { PLATFORM_SKILL_CATALOG } from "../../apps/api/src/domain/skill/platform-skill-catalog";
import { NATIVE_PROFILE_TOOLS } from "../../apps/api/src/application/agent-run/native-invocation";

const prompt = buildRatingPrompt([]);
const platformSkills = PLATFORM_SKILL_CATALOG.map((s) => s.stableName);
const nativeTools: readonly string[] = NATIVE_PROFILE_TOOLS;

describe("任务书依赖的能力真实存在", () => {
  it("点名要求使用的 skill 都是平台级默认可见的", () => {
    // 形如「用 pdf-create 生成」「用 xlsx-create 生成」的硬要求。
    const demanded = [...prompt.matchAll(/用 ([a-z][a-z0-9-]{3,}) (?:生成|执行|计算)/g)].map((m) => m[1]!);
    expect(demanded.length).toBeGreaterThan(0);
    const notPlatform = demanded.filter((name) => !platformSkills.includes(name) && !nativeTools.includes(name));
    expect(notPlatform).toEqual([]);
  });

  it("算分这一步指向一定存在的 native 工具，而不是某个可能没启用的 skill", () => {
    expect(nativeTools).toContain("execute");
    expect(nativeTools).toContain("write_file");
    expect(prompt).toContain("用 write_file 写一个 Python 脚本，再用 execute 执行它");
  });

  it("即使某个 skill 缺席也不许退回心算——这条兜底话术必须在", () => {
    expect(prompt).toContain("不要因为找不到某个 skill 就退回心算");
  });

  it("任务书用到的每个 wx_* / web_* 工具都在 native 准入表里", () => {
    const used = [...new Set([...prompt.matchAll(/\b((?:wx_|web_)[a-z_]+)\b/g)].map((m) => m[1]!))];
    expect(used.length).toBeGreaterThan(3);
    expect(used.filter((t) => !nativeTools.includes(t))).toEqual([]);
  });
});
