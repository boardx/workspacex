import {
  FileWorkflowDefinitionStore,
  resolveWorkflowDefinitionsRoot,
} from "../src/infrastructure/agent/file-workflow-definition-store";
/** Read-only image admission: the enable offer must resolve in this exact runtime. */
import {
  buildOfficialAgentRolePack,
  officialRoleSkillPacks,
} from "../src/domain/agent/official-role-packs";
import {
  skillContentDigest,
  verifySkillStarterPack,
} from "../src/domain/skill/starter-pack";
import {
  FileSkillStarterPackSource,
  resolveSkillStarterPackRoot,
} from "../src/infrastructure/skill/file-skill-starter-pack-source";

try {
  const root = resolveSkillStarterPackRoot();
  if (!root) throw new Error("missing configured root");
  const source = new FileSkillStarterPackSource(root);
  const contents = new Map<string, string>();
  const packs = officialRoleSkillPacks();
  for (const coordinate of packs) {
    const pack = verifySkillStarterPack(
      await source.load(coordinate.packId, coordinate.packVersion),
      coordinate,
    );
    for (const skill of pack.skills) {
      const digest = skillContentDigest(skill);
      const previous = contents.get(skill.stableName);
      if (previous !== undefined && previous !== digest)
        throw new Error("conflicting content");
      contents.set(skill.stableName, digest);
    }
  }
  const roles = buildOfficialAgentRolePack().agents;
  const workflowStore = new FileWorkflowDefinitionStore(
    resolveWorkflowDefinitionsRoot(),
  );
  const workflows = new Set(
    roles.flatMap((role) => [...role.role.workflowAllowlist]),
  );
  for (const id of workflows) {
    if (
      !(await workflowStore.isRegistered(id)) ||
      !(await workflowStore.resolveName(id))
    )
      throw new Error("missing or unreadable official workflow definition");
  }
  for (const role of roles) {
    for (const binding of role.authoredSkillBindings ?? []) {
      if (contents.get(binding.stableName) !== binding.contentDigest)
        throw new Error("missing fixed role content");
    }
  }
  console.log(
    JSON.stringify({
      ok: true,
      roles: roles.length,
      packs: packs.length,
      workflows: workflows.size,
    }),
  );
} catch {
  // Never publish package text, environment or raw filesystem errors in build logs.
  console.error("OFFICIAL_ROLE_PACKS_INVALID");
  process.exitCode = 1;
}
