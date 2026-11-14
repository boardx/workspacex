/** AIDT is an optional module, outside the default platform skill catalog. */
export const AIDT_PLATFORM_SKILL_PACK = { packId: 'aidt-methods', packVersion: '1.2.0' } as const;

/** Only explicit deployment opt-in enables bootstrap; unset/unknown values stay off. */
export function parseAidtModuleEnabled(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

export function isAidtModuleEnabled(): boolean {
  return parseAidtModuleEnabled(process.env.ENABLE_AIDT_MODULE);
}
