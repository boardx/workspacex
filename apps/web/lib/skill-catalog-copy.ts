import { workSkillDisplayName } from "./work-skill-display-copy";
import { WORK_SKILL_DESCRIPTIONS } from "./work-skill-descriptions.generated";

export function skillCatalogTitle(name: string): string {
  return workSkillDisplayName(name) ?? name;
}

export function skillCatalogDescription(name: string, description?: string | null): string | undefined {
  const text = description?.trim();
  if (text && !/^skill$/i.test(text)) return text;
  const stableId = name.trim().toUpperCase();
  return /^S[0-9]{3}$/.test(stableId) ? WORK_SKILL_DESCRIPTIONS[stableId] : undefined;
}
