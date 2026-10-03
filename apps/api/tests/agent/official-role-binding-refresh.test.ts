import { describe, expect, it } from "vitest";
import { buildOfficialAgentRolePack } from "../../src/domain/agent/official-role-packs";
import { AGENT_ROLE_COLUMN_OF } from "../../src/infrastructure/agent/agent-version-insert";
import { officialRoleBindingLabel, PgOfficialRoleUpgradeRepository } from "../../src/infrastructure/agent/pg-official-role-upgrade-repository";

const pack = buildOfficialAgentRolePack();
const target = pack.agents.find((role) => role.roleRef === "D002")!;
const first = target.authoredSkillBindings![0]!;
const second = target.authoredSkillBindings![1]!;
function fixture() {
  const fields = Object.fromEntries(Object.entries(AGENT_ROLE_COLUMN_OF).map(([key, column]) => [column, target.role[key as keyof typeof target.role]]));
  const published = { ...fields, catalog_source: "official", tool_policy: target.toolPolicy };
  const role = { id: "research", stable_name: target.stableName, name: target.name, published_version_id: "current",
    semantic_label: target.semanticVersion, instructions: target.instructions, instruction_digest: target.instructionDigest,
    model_provider: target.modelProvider, model_id: target.modelId, skill_version_ids: [] as string[],
    published, draft: { ...published, role_label: target.roleLabel } };
  const ledger = { pack_version: pack.packVersion, pack_digest: pack.packDigest, result_json: { agentIds: [role.id], versionIds: [role.published_version_id] } };
  const skills = new Map([[first.stableName, { skill_id: "skill-first", version_id: "verified-first", name: "检索", published: true, channel: "verified" }]]);
  const session = { query: async (sql: string, args: unknown[] = []) => {
    if (sql.includes("FROM agents a JOIN agent_versions")) return { rows: [role] };
    if (sql.includes("FROM agent_starter_pack_imports")) return { rows: [ledger] };
    if (sql.includes("FROM skill_versions v JOIN skills")) return { rows: skills.has(String(args[2])) ? [skills.get(String(args[2]))] : [] };
    throw new Error("unexpected repository query");
  } };
  const repo = new PgOfficialRoleUpgradeRepository({ withTenant: async (_org: unknown, action: (s: typeof session) => unknown) => action(session) } as never);
  const offers = () => repo.offers("org-research" as never, pack);
  return { role, ledger, skills, offers };
}

describe("official role Skill binding refresh after verification", () => {
  it("binding labels are unique, order independent and do not mutate the pack version", () => {
    expect(officialRoleBindingLabel("1.6.0", ["a", "b"])).toBe(officialRoleBindingLabel("1.6.0", ["b", "a"]));
    expect(officialRoleBindingLabel("1.6.0", ["a"])).not.toBe("1.6.0");
    expect(officialRoleBindingLabel("1.6.0", ["a"])).not.toBe(officialRoleBindingLabel("1.6.0", ["a", "b"]));
  });
  it("offers a new immutable binding version when an authored pending Skill becomes verified", async () => {
    const f = fixture();
    expect(await f.offers()).toEqual([{ agentId: "research", expectedPublishedVersionId: "current", name: target.name,
      currentVersion: pack.packVersion, targetVersion: pack.packVersion, readySkillCount: 1, pendingSkillCount: 9 }]);
  });
  it("never offers candidate Skills or an unchanged binding", async () => {
    const f = fixture(); f.skills.get(first.stableName)!.channel = "candidate";
    expect(await f.offers()).toEqual([]);
    f.skills.get(first.stableName)!.channel = "verified"; f.role.skill_version_ids = ["verified-first"];
    expect(await f.offers()).toEqual([]);
  });
  it("adds only newly verified authored pins while retaining existing exact pins", async () => {
    const f = fixture(); f.role.skill_version_ids = ["verified-first"];
    f.role.semantic_label = officialRoleBindingLabel(target.semanticVersion, f.role.skill_version_ids);
    f.skills.set(second.stableName, { skill_id: "skill-second", version_id: "verified-second", name: "综合", published: true, channel: "verified" });
    expect((await f.offers())[0]?.readySkillCount).toBe(2);
  });
  it.each(["custom-pins", "custom-role", "custom-model", "wrong-provenance", "unpublished", "forged-binding-label"])("rejects %s without granting bindings", async (change) => {
    const f = fixture();
    if (change === "custom-pins") f.role.skill_version_ids = ["foreign-pin"];
    if (change === "custom-role") Object.assign(f.role.draft, { tags: ["custom"] });
    if (change === "custom-model") f.role.model_id = "custom";
    if (change === "wrong-provenance") f.ledger.pack_digest = "not-the-signed-pack";
    if (change === "forged-binding-label") f.role.semantic_label = `${target.semanticVersion}+bindings.forged`;
    if (change === "unpublished") f.skills.get(first.stableName)!.published = false;
    expect(await f.offers()).toEqual([]);
  });
});
