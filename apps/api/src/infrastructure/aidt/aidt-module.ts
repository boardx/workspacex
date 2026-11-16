/** AIDT is an optional module, outside the default platform skill catalog. */
export const AIDT_PLATFORM_SKILL_PACK = { packId: 'aidt-methods', packVersion: '1.3.1' } as const;
/** Separate course report task: six method stages remain unchanged. */
export const AIDT_SUMMARY_SKILL_PACK = { packId: 'aidt-project-summary', packVersion: '1.0.1' } as const;
export const AIDT_OPT_IN_SKILL_PACKS = [AIDT_PLATFORM_SKILL_PACK, AIDT_SUMMARY_SKILL_PACK] as const;

/** Only explicit deployment opt-in enables bootstrap; unset/unknown values stay off. */
export function parseAidtModuleEnabled(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

export function isAidtModuleEnabled(): boolean {
  return parseAidtModuleEnabled(process.env.ENABLE_AIDT_MODULE);
}
