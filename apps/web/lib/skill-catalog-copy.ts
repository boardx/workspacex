import { isWorkSkillStableId, workSkillDisplayName } from "./work-skill-display-copy";
import { WORK_SKILL_DESCRIPTIONS } from "./work-skill-descriptions.generated";

export function skillCatalogTitle(name: string, workSkillId?: string | null): string {
  return workSkillId && name.trim().toUpperCase() === workSkillId.toUpperCase()
    ? workSkillDisplayName(workSkillId.toUpperCase()) ?? name
    : name;
}

export function skillCatalogDescription(workSkillId: string | null | undefined, description?: string | null): string | undefined {
  const text = description?.trim();
  if (text && !/^skill$/i.test(text)) return text;
  const stableId = workSkillId?.trim().toUpperCase();
  return stableId && isWorkSkillStableId(stableId) ? WORK_SKILL_DESCRIPTIONS[stableId] : undefined;
}
