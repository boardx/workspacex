import type { SkillStarterPackSource } from '../../application/skill-import/ports';
import { verifySkillStarterPack } from '../../domain/skill/starter-pack';
import { STANDARD_PLATFORM_PACKS } from './ensure-standard-skill-packs';

/** The shipped skill remains the single source of report-writing instructions. */
export async function loadInterviewReportSkill(source: SkillStarterPackSource): Promise<string> {
  const release = STANDARD_PLATFORM_PACKS.find(pack => pack.packId === 'standard-methods')!;
  const pack = verifySkillStarterPack(await source.load(release.packId, release.packVersion), release);
  const file = pack.skills.find(skill => skill.stableName === 'interview-synthesis')?.files.find(file => file.path === 'SKILL.md');
  if (!file) throw new Error('INTERVIEW_REPORT_SKILL_UNAVAILABLE');
  return Buffer.from(file.contentBase64, 'base64').toString('utf8');
}
