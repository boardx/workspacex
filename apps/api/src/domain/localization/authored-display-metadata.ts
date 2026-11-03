import { createHash } from "node:crypto";
import { wave2Runtime } from "@repo/contracts";
import { PackLocalization } from "@repo/contracts/pack-localization";
import type { EntityKind, EntityDisplaySource } from "@repo/contracts/entity-localization";
import type { z } from "zod";
import data from "../../../../../skills/localizations/work-stack-v2.json";
import { buildOfficialAgentRolePack } from "../agent/official-role-packs";
import { verifySkillStarterPack, type SkillStarterPack } from "../skill/starter-pack";

export const AUTHORED_DISPLAY_METADATA = data;
export const DISPLAY_METADATA_VERSION = data.metadataVersion;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
export const DISPLAY_METADATA_DIGEST = sha(JSON.stringify(data));

/** A known identity alone never licenses replacing an independently authored
 * original. Only fields still equal to a known authored title receive its copy. */
export function authoredTranslations(kind: EntityKind, stableId: string, source: z.infer<typeof EntityDisplaySource>["fields"]) {
  const titles = kind === "skill" ? data.skills[stableId as keyof typeof data.skills] : data.agents[stableId as keyof typeof data.agents];
  if (!titles) return null;
  const names = Object.values(titles).map(copy => copy.name);
  const stockName = names.includes(source.name) || (kind === "skill" && (source.name === stableId || names.some(name => source.name === `${name}（${stableId}）`)));
  const roleLabel = kind === "agent" && source.roleLabel !== null && names.includes(source.roleLabel);
  const avatarAlt = kind === "agent" && source.avatarAlt !== null && names.includes(source.avatarAlt);
  if (!stockName && !roleLabel && !avatarAlt) return null;
  return PackLocalization.shape.translations.parse(Object.fromEntries(Object.entries(titles).map(([locale,copy]) => [locale, {
    ...(stockName ? { name: copy.name } : {}), ...(roleLabel ? { roleLabel: copy.name } : {}), ...(avatarAlt ? { avatarAlt: copy.name } : {}),
  }])));
}

export function localizeShippedSkillPack(input: SkillStarterPack) {
  const base = data.packages[input.packId as keyof typeof data.packages];
  if (!base || input.packVersion !== base.baseVersion || input.packDigest !== base.baseDigest) throw new Error("unrecognized_authored_skill_base");
  const pack = verifySkillStarterPack(input,input);
  const { packDigest: _digest, ...legacy } = pack;
  const unsigned = wave2Runtime.UnsignedSkillStarterPackV2.parse({ ...legacy,
    schemaVersion: 2, packVersion: data.metadataVersion,
    skills: pack.skills.map(entry => {
      const work = entry.manifest.work as { stableId?: unknown } | undefined;
      const titles = typeof work?.stableId === "string" ? data.skills[work.stableId as keyof typeof data.skills] : undefined;
      if (!titles) throw new Error("missing_authored_skill_title");
      return { ...entry, localization: PackLocalization.parse({ sourceLocale: null, translations: titles }) };
    }),
  });
  return wave2Runtime.SkillStarterPackV2.parse({ ...unsigned, packDigest: sha(JSON.stringify(unsigned)) });
}
export function buildLocalizedOfficialPack() {
  const { packDigest: _digest, ...legacy } = buildOfficialAgentRolePack();
  const unsigned = wave2Runtime.UnsignedOfficialAgentStarterPackV2.parse({ ...legacy,
    schemaVersion: 2, packVersion: data.metadataVersion,
    agents: legacy.agents.map(entry => {
      const titles = data.agents[entry.roleRef as keyof typeof data.agents];
      if (!titles || titles["zh-CN"].name !== entry.name) throw new Error("authored_agent_source_title_drift");
      const fields = Object.fromEntries(Object.entries(titles).map(([locale,copy]) => [locale, {
        name: copy.name, roleLabel: copy.name, ...(entry.role.avatar ? { avatarAlt: copy.name } : {}),
      }]));
      return { ...entry, localization: PackLocalization.parse({ sourceLocale: "zh-CN", translations: fields }) };
    }),
  });
  return wave2Runtime.OfficialAgentStarterPackV2.parse({ ...unsigned, packDigest: sha(JSON.stringify(unsigned)) });
}
