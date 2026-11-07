import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("../../src/infrastructure/agent/resolve-official-role-skill-refs.ts", import.meta.url), "utf8");
describe("official coordinate resolver permission exemption", () => {
  it("reads only Skill coordinate metadata through the supplied tenant transaction", () => {
    const tables = [...source.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/gi)].map((match) => match[1]);
    expect(tables).toEqual(["skill_versions", "skills", "skill_catalog_entries"]);
    expect(source).not.toMatch(/withoutTenant|\b(?:INSERT|UPDATE|DELETE)\s/i);
    expect(source).toContain("session: TenantSession");
    expect(source).toContain("v.org_id=$1 AND e.stable_id=$2 AND s.stable_name=$3 AND v.content_digest=$4");
    expect(source).toContain("[orgId, coordinate.stableId, coordinate.stableName, coordinate.contentDigest]");
    expect(source).not.toMatch(/SELECT\s+\*|file_content|content_base64/);
  });
  it("pins published verified matches only and explicitly records every other coordinate", () => {
    expect(source).toContain('row?.published && row.channel === "verified"');
    expect(source).toContain('reason: row?.published ? "awaiting_verification" : "missing_version"');
    expect(source).toContain("const coordinates = agent.authoredSkillBindings");
  });
});

describe("verified bilingual official package coordinate resolution", () => {
  it("uses the same reviewed direct Skill slots as the exact legacy official package", async () => {
    const { buildOfficialAgentRolePack } = await import("../../src/domain/agent/official-role-packs");
    const { buildLocalizedOfficialPack } = await import("../../src/domain/localization/authored-display-metadata");
    const { resolveOfficialRoleSkillRefs } = await import("../../src/infrastructure/agent/resolve-official-role-skill-refs");
    const session = { query: vi.fn(async () => ({ rows: [] })) };
    const legacy = await resolveOfficialRoleSkillRefs(session,"organization",buildOfficialAgentRolePack());
    const localized = await resolveOfficialRoleSkillRefs(session,"organization",buildLocalizedOfficialPack());
    expect(legacy.size).toBe(7);
    for (const role of legacy.values()) expect(role.pending.length).toBeGreaterThan(0);
    expect(localized).toEqual(legacy);
  });
  it("does not trust another valid metadata envelope just because it reuses the official coordinates", async () => {
    const { buildLocalizedOfficialPack } = await import("../../src/domain/localization/authored-display-metadata");
    const { verifyOfficialAgentStarterPack } = await import("../../src/domain/agent/starter-pack");
    const { sha256 } = await import("../../src/domain/skill/starter-pack");
    const { resolveOfficialRoleSkillRefs } = await import("../../src/infrastructure/agent/resolve-official-role-skill-refs");
    const { packDigest: _digest,...unsigned } = buildLocalizedOfficialPack();
    unsigned.agents[0]!.localization.translations.en!.name = "Different authored envelope";
    const pack = { ...unsigned,packDigest: sha256(JSON.stringify(unsigned)) };
    verifyOfficialAgentStarterPack(pack,pack);
    const session = { query: vi.fn(async () => ({ rows: [] })) };
    const result = await resolveOfficialRoleSkillRefs(session,"organization",pack);
    expect(session.query).not.toHaveBeenCalled();
    for (const role of result.values()) expect(role).toEqual({ pins: [],pending: [] });
  });
});
