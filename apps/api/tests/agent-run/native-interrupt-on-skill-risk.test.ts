/**
 * issue #3437 —— devapp 真机实测（run 34594941550）：唯一挂载的 skill 是 L0 的
 * `pdf-create`（#2782 的既有裁决），但原生模式（`native_graph.py`）下 pdf-create
 * 自己的生成脚本是通过 `execute` 这一个工具跑的，`execute` 在 `tool-risk-tier.ts`
 * 里被**刻意**分类为 L2（I-1，"没有例外"）——`nativeInterruptOn()` 此前无条件把它
 * 置 `true`，于是 15 分钟没人点审批框，run 卡到超时。
 *
 * 反证顺序（三步）：
 * ① 造出缺陷形状——不传 `allSkillsAreL0`（等价于修复前的无条件调用）时，`execute`
 *    必须仍然是 `true`（这条本身就是修复前的行为，红/绿都要能跑通，证明这份测试
 *    真的在挂着这个键，不是空转）。
 * ② 会话只挂载 L0 skill 时，`execute` 必须放行（`false`）——这是本 PR 要新增的行为，
 *    修复前会红。
 * ③ 挂载了任何一个非 L0 skill（哪怕和 L0 skill 混在一起）时，`execute` 必须仍然是
 *    `true`——不能因为混进一个 L0 skill 就放宽整条会话，验证豁免没有过宽。
 */
import { describe, expect, it } from "vitest";
import { NATIVE_PROFILE_TOOLS, nativeInterruptOn } from "../../src/application/agent-run/native-invocation";
import { resolveSkillRiskLevels } from "../../src/domain/agent-run/skill-risk-level";

const PDF_CREATE_PIN = { stableName: "pdf-create", content: "any content -- risk comes from the platform catalog, not frontmatter" };
const UNGRADED_SKILL_PIN = { stableName: "org-custom-skill", content: "# org-custom-skill\n\nno risk_level frontmatter at all" };

describe("nativeInterruptOn 的会话级 execute 豁免（issue #3437）", () => {
  it("① 缺省（未传 allSkillsAreL0）—— execute 保持修复前的保守默认：true", () => {
    const policy = nativeInterruptOn();
    expect(policy["execute"]).toBe(true);
    // 准入表其余名字的分级不受这次改动影响。
    expect(Object.keys(policy).sort()).toEqual([...NATIVE_PROFILE_TOOLS].sort());
  });

  it("② 本次 run 挂载的 skill 全部是 L0（pdf-create）—— execute 放行，不弹审批", () => {
    const skillRisks = resolveSkillRiskLevels([PDF_CREATE_PIN]);
    expect(skillRisks).toEqual([{ stableName: "pdf-create", riskLevel: "L0" }]);
    const allSkillsAreL0 = skillRisks.length > 0 && skillRisks.every((entry) => entry.riskLevel === "L0");
    expect(allSkillsAreL0).toBe(true);
    const policy = nativeInterruptOn({ allSkillsAreL0 });
    expect(policy["execute"]).toBe(false);
  });

  it("③ 混入一个非 L0 skill —— execute 仍然要求审批（豁免没有过宽）", () => {
    const skillRisks = resolveSkillRiskLevels([PDF_CREATE_PIN, UNGRADED_SKILL_PIN]);
    // 未声明 risk_level 的组织自建 skill 落到 SKILL_RISK_DEFAULT_LEVEL（今天是 L1），不是 L0。
    expect(skillRisks.find((e) => e.stableName === "org-custom-skill")?.riskLevel).not.toBe("L0");
    const allSkillsAreL0 = skillRisks.length > 0 && skillRisks.every((entry) => entry.riskLevel === "L0");
    expect(allSkillsAreL0).toBe(false);
    const policy = nativeInterruptOn({ allSkillsAreL0 });
    expect(policy["execute"]).toBe(true);
  });

  it("④ 未挂载任何 skill —— fail-closed，execute 仍要求审批", () => {
    const skillRisks = resolveSkillRiskLevels([]);
    const allSkillsAreL0 = skillRisks.length > 0 && skillRisks.every((entry) => entry.riskLevel === "L0");
    expect(allSkillsAreL0).toBe(false);
    expect(nativeInterruptOn({ allSkillsAreL0 })["execute"]).toBe(true);
  });

  it("⑤ 豁免只作用于 execute：其余 L2 工具（如 delete/sql_db_query）依旧无条件要求审批", () => {
    const policy = nativeInterruptOn({ allSkillsAreL0: true });
    expect(policy["delete"]).toBe(true);
    expect(policy["sql_db_query"]).toBe(true);
  });
});
