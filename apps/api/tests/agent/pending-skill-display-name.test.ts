import { expect, it } from "vitest";
import { buildOfficialAgentRolePack, officialRoleSkillDisplayName } from "../../src/domain/agent/official-role-packs";
import { resolveOfficialRoleSkillRefs } from "../../src/infrastructure/agent/resolve-official-role-skill-refs";
import type { TenantSession } from "../../src/application/ports/database.port";

async function resolve(name?: string, verified = false) {
  const pack = buildOfficialAgentRolePack();
  const session = { query: async (_sql: string, args: unknown[]) => ({ rows: [{ skill_id: `skill-${args[1]}`, version_id: `version-${args[1]}`, name: name ?? args[1], published: true, channel: verified ? "verified" : "candidate" }] }) } as unknown as TenantSession;
  const role = pack.agents.find(agent => agent.roleRef === "D003")!;
  return (await resolveOfficialRoleSkillRefs(session, "org", pack)).get(role.stableName)!;
}
it("replaces bare stable IDs with titles from exact immutable authored Skill bytes", async () => {
  const result = await resolve();
  expect(result.pins).toEqual([]);
  expect(result.pending.find(skill => skill.stableId === "S061")).toMatchObject({ displayName: "产品探索（S061）", reason: "awaiting_verification" });
  expect(result.pending.find(skill => skill.stableId === "S009")).toMatchObject({ displayName: "客户研究（S009）", reason: "awaiting_verification" });
});
it("preserves a real catalog title and verified execution decisions", async () => {
  expect((await resolve("已发布中文标题")).pending.every(skill => skill.displayName === "已发布中文标题")).toBe(true);
  const verified = await resolve(undefined, true);
  expect(verified.pending).toEqual([]);
  expect(verified.pins.length).toBeGreaterThan(0);
});
it("never resolves a title by stable ID or name when the content digest differs", () => {
  const coordinate = buildOfficialAgentRolePack().agents.find(agent => agent.roleRef === "D003")!.authoredSkillBindings![0]!;
  expect(officialRoleSkillDisplayName({ ...coordinate, contentDigest: "0".repeat(64) })).toBeNull();
  expect(officialRoleSkillDisplayName({ ...coordinate, stableName: "wrong-name" })).toBeNull();
});
