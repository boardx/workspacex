import { createHash } from "node:crypto";
import { AgentRoleFields, AGENT_ROLE_FIELD_DEFAULTS } from "@repo/contracts/agent-role";
import { wave2Runtime } from "@repo/contracts";
import type { SkillStarterPack } from "../skill/starter-pack";
import type { AgentStarterPack, OfficialAgentStarterPack } from "../agent/starter-pack";

export type PortablePack = { kind: "skill"; pack: SkillStarterPack }
  | { kind: "agent"; pack: AgentStarterPack }
  | { kind: "official-agent"; pack: OfficialAgentStarterPack };
type AgentEntry = AgentStarterPack["agents"][number] | OfficialAgentStarterPack["agents"][number];
const FrozenRole = AgentRoleFields.omit({ catalogSource: true });
const { catalogSource: _source, ...defaultRole } = AGENT_ROLE_FIELD_DEFAULTS;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => order(a, b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export function canonicalJson(value: unknown): string { return JSON.stringify(canonical(value)); }

/** Shared with persistence: absence keeps the historical placeholder, never a new duty. */
export function starterAgentDisplayDefaults(entry: AgentEntry) {
  const official = "roleRef" in entry;
  const roleLabel = "roleLabel" in entry && entry.roleLabel !== undefined ? entry.roleLabel : entry.stableName.slice(0, 8);
  const fallbackDuty = official ? roleLabel : entry.name;
  const duty = "duty" in entry ? entry.duty ?? fallbackDuty : fallbackDuty;
  const role = FrozenRole.parse("role" in entry ? entry.role ?? defaultRole : defaultRole);
  return { roleLabel, duty, role };
}

/** Matching fingerprint for verified source definitions, not an execution digest.
 * Translation copy and package releases may change without re-publishing execution. */
export function sourceDefinitionDigest(input: PortablePack): string {
  const entries = input.kind === "skill" ? input.pack.skills.map(entry => ({
    stableName: entry.stableName, name: entry.name, semanticVersion: entry.semanticVersion,
    manifest: entry.manifest, duty: "duty" in entry ? entry.duty ?? null : null,
    files: entry.files.map(({ path, mediaType, digest }) => ({ path, mediaType, digest })).sort((a, b) => order(a.path, b.path)),
  })) : input.pack.agents.map(entry => ({
    stableName: entry.stableName, name: entry.name, semanticVersion: entry.semanticVersion,
    instructionDigest: entry.instructionDigest, skillVersions: entry.skillVersions,
    modelProvider: entry.modelProvider, modelId: entry.modelId, toolPolicy: entry.toolPolicy,
    ...starterAgentDisplayDefaults(entry),
    ...("roleRef" in entry ? { roleRef: entry.roleRef, authoredSkillBindings: entry.authoredSkillBindings } : {}),
  }));
  return sha(canonicalJson({ format: "portable-source-v1", kind: input.kind, packId: input.pack.packId,
    entries: entries.sort((a, b) => order(a.stableName, b.stableName)) }));
}

/** Prove an unchanged legacy base against the import ledger's original v1 digest.
 * Extra v2 snapshots still require comparison with the current published entity. */
export function legacyEquivalentDigest(input: PortablePack, packVersion: string): string | null {
  try {
    const coordinates = { schemaVersion: 1, packId: input.pack.packId, packVersion };
    const unsigned = input.kind === "skill"
      ? wave2Runtime.UnsignedSkillStarterPack.parse({ ...coordinates, skills: input.pack.skills.map(entry => wave2Runtime.SkillStarterPackEntry.strip().parse(entry)) })
      : input.kind === "agent"
        ? wave2Runtime.UnsignedAgentStarterPack.parse({ ...coordinates, agents: input.pack.agents.map(entry => wave2Runtime.AgentStarterPackEntry.strip().parse(entry)) })
        : wave2Runtime.UnsignedOfficialAgentStarterPack.parse({ ...coordinates, agents: input.pack.agents.map(entry => wave2Runtime.OfficialAgentStarterPackEntry.strip().parse(entry)) });
    return sha(JSON.stringify(unsigned));
  } catch { return null; }
}

/** Keep valid long source names distinct in the package namespace. */
export function portableExportPackId(stableName: string): string {
  const prefix = `export-${stableName}`;
  return prefix.length <= 128 ? prefix : `${prefix.slice(0,63)}-${createHash("sha256").update(stableName).digest("hex")}`;
}
