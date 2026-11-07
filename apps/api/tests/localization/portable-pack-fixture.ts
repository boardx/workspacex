import { createHash } from "node:crypto";
import { wave2Runtime, agentRole } from "@repo/contracts";
export const sha = (value: string) => createHash("sha256").update(value).digest("hex");
export const sourceFile = "---\nname: portable-skill\n---\n# Original instructions\n";
const skill = { stableName: "portable-skill", name: "Original skill", semanticVersion: "1.0.0", manifest: { description: "Original summary", entrypoint: "SKILL.md" },
  files: [{ path: "SKILL.md", mediaType: "text/markdown", digest: sha(sourceFile), contentBase64: Buffer.from(sourceFile).toString("base64") }] };
const agent = { stableName: "portable-agent", name: "Original agent", semanticVersion: "1.0.0", instructions: "Original instructions",
  instructionDigest: sha("Original instructions"), skillVersions: [], modelProvider: "configured", modelId: "configured-model", toolPolicy: [] };
export function localization(name = "Translated name") { return { sourceLocale: null, translations: { en: { name } } }; }
export function skillV1() {
  const unsigned = wave2Runtime.UnsignedSkillStarterPack.parse({ schemaVersion: 1, packId: "portable-skill", packVersion: "1.0.0", skills: [skill] });
  return { ...unsigned, packDigest: sha(JSON.stringify(unsigned)) };
}
export function skillV2(name = "Translated name") {
  const unsigned = wave2Runtime.UnsignedSkillStarterPackV2.parse({ schemaVersion: 2, packId: "portable-skill", packVersion: "2.0.0", skills: [{ ...skill, localization: localization(name) }] });
  return { ...unsigned, packDigest: sha(JSON.stringify(unsigned)) };
}
export function agentV1() {
  const unsigned = wave2Runtime.UnsignedAgentStarterPack.parse({ schemaVersion: 1, packId: "portable-agent", packVersion: "1.0.0", agents: [agent] });
  return { ...unsigned, packDigest: sha(JSON.stringify(unsigned)) };
}
export function agentV2(name = "Translated name") {
  const unsigned = wave2Runtime.UnsignedAgentStarterPackV2.parse({ schemaVersion: 2, packId: "portable-agent", packVersion: "2.0.0", agents: [{ ...agent, localization: localization(name) }] });
  return { ...unsigned, packDigest: sha(JSON.stringify(unsigned)) };
}
export function officialV1() {
  const { catalogSource: _source, ...role } = agentRole.AGENT_ROLE_FIELD_DEFAULTS;
  const unsigned = wave2Runtime.UnsignedOfficialAgentStarterPack.parse({ schemaVersion: 1, packId: "portable-official", packVersion: "1.0.0", agents: [{ ...agent, roleRef: "D003", roleLabel: "Original label", role }] });
  return { ...unsigned, packDigest: sha(JSON.stringify(unsigned)) };
}
export function officialV2(name = "Translated name") {
  const { packDigest: _digest, ...original } = officialV1();
  const unsigned = wave2Runtime.UnsignedOfficialAgentStarterPackV2.parse({ ...original, schemaVersion: 2, packVersion: "2.0.0", agents: original.agents.map(entry => ({ ...entry, localization: localization(name) })) });
  return { ...unsigned, packDigest: sha(JSON.stringify(unsigned)) };
}
