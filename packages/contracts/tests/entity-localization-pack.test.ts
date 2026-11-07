import { describe, expect, it } from "vitest";
import { wave2Runtime as packs, agentRole } from "../src";

const digest = "a".repeat(64);
const skill = { stableName: "portable-skill", name: "原文", semanticVersion: "1.0.0", manifest: { description: "Original summary" },
  files: [{ path: "SKILL.md", mediaType: "text/markdown", digest, contentBase64: "b3JpZ2luYWw=" }] };
const agent = { stableName: "portable-agent", name: "原角色", semanticVersion: "1.0.0", instructions: "Original instructions",
  instructionDigest: digest, skillVersions: [], modelProvider: "configured", modelId: "configured-model", toolPolicy: [] };
const localization = { sourceLocale: null, translations: { en: { name: "Translated name", duty: "Translated duty" }, "zh-CN": { name: "原文显示名" } } };
const skillPack = (schemaVersion: number, entry = skill) => ({ schemaVersion, packId: "portable-skill", packVersion: "1.0.0", skills: [entry], packDigest: digest });
const agentPack = (schemaVersion: number, entry = agent) => ({ schemaVersion, packId: "portable-agent", packVersion: "1.0.0", agents: [entry], packDigest: digest });

describe("portable display metadata pack contracts", () => {
  it("keeps v1 parsed bytes and strict entry boundaries unchanged", () => {
    for (const [schema, original] of [[packs.SkillStarterPack, skillPack(1)], [packs.AgentStarterPack, agentPack(1)]] as const) {
      expect(JSON.stringify(schema.parse(original))).toBe(JSON.stringify(original));
    }
    expect(packs.SkillStarterPack.safeParse(skillPack(1, { ...skill, localization } as typeof skill)).success).toBe(false);
    expect(packs.AgentStarterPack.safeParse(agentPack(1, { ...agent, localization } as typeof agent)).success).toBe(false);
  });
  it("accepts v2 display metadata without changing source or execution fields", () => {
    const input = skillPack(2, { ...skill, duty: "Original duty", localization } as typeof skill);
    const parsed = packs.SkillStarterPack.parse(input);
    expect(parsed).toEqual(input);
    expect(parsed.skills[0]!.files).toEqual(skill.files);
    expect(parsed.skills[0]!.name).toBe(skill.name);
  });
  it("does not guess a source language and rejects unsupported display locales", () => {
    const input = skillPack(2, { ...skill, localization } as typeof skill);
    expect(packs.SkillStarterPack.safeParse(input).success).toBe(true);
    for (const invalid of [
      { ...localization, sourceLocale: "auto" },
      { ...localization, translations: { "en-US": { name: "No alias inference" } } },
    ]) expect(packs.SkillStarterPack.safeParse(skillPack(2, { ...skill, localization: invalid } as typeof skill)).success).toBe(false);
  });
  it("rejects execution content and tenant coordinates inside portable translations", () => {
    for (const invalid of [
      { ...localization, translations: { en: { instructions: "rewrite" } } },
      { ...localization, orgId: "foreign" },
      { ...localization, sourceRevision: "foreign-database-revision" },
    ]) expect(packs.SkillStarterPack.safeParse(skillPack(2, { ...skill, localization: invalid } as typeof skill)).success).toBe(false);
  });
  it("preserves ordinary Agent display and frozen-role snapshots in v2", () => {
    const { catalogSource: _source, ...role } = agentRole.AGENT_ROLE_FIELD_DEFAULTS;
    const input = agentPack(2, { ...agent, roleLabel: "Original label", duty: "Original duty", role, localization } as typeof agent);
    expect(packs.AgentStarterPack.parse(input)).toEqual(input);
    expect(input.agents[0]!.instructions).toBe(agent.instructions);
  });
  it("keeps official v1 field ordering and supports metadata only in a new version", () => {
    const { catalogSource: _source, ...role } = agentRole.AGENT_ROLE_FIELD_DEFAULTS;
    const entry = { ...agent, roleRef: "D003", roleLabel: "Product Manager", role };
    const original = { ...agentPack(1), agents: [entry] };
    expect(JSON.stringify(packs.OfficialAgentStarterPack.parse(original))).toBe(JSON.stringify(original));
    expect(packs.OfficialAgentStarterPack.parse({ ...original, schemaVersion: 2, agents: [{ ...entry, localization }] })).toMatchObject({ schemaVersion: 2 });
  });
  it("retains long valid original names in v2 without relaxing v1 or translated names", () => {
    const name = "名".repeat(5000);
    expect(packs.SkillStarterPack.safeParse(skillPack(1, { ...skill, name })).success).toBe(false);
    expect(packs.SkillStarterPack.parse(skillPack(2, { ...skill, name, localization } as typeof skill)).skills[0]!.name).toBe(name);
    expect(packs.SkillStarterPack.safeParse(skillPack(2, { ...skill, localization: { ...localization, translations: { en: { name } } } } as typeof skill)).success).toBe(false);
  });
});
