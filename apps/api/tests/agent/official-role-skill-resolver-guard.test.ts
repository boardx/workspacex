import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
