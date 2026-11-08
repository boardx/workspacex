import { workSkillDisplayName } from './work-skill-display-copy';
import { localizedText } from './entity-localization';
import type { SkillListItem } from './live-skill';
/** Display-only projection. Stable identity and published version remain untouched. */
export function skillPickerDisplay<T extends Pick<SkillListItem,'name'|'duty'> & Partial<Pick<SkillListItem,'display'|'taskDescription'>>>(row:T):T {
 return {...row,name:localizedText(row.display,'name',workSkillDisplayName(row.name)??row.name),
  duty:localizedText(row.display,'duty',row.taskDescription?.trim()||row.duty)};
}
