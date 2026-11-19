/** Shipped AIDT packs, available through normal platform bootstrap. */
export const AIDT_PLATFORM_SKILL_PACK = { packId: 'aidt-methods', packVersion: '1.3.2' } as const;
/** Separate course report task: six method stages remain unchanged. */
export const AIDT_SUMMARY_SKILL_PACK = { packId: 'aidt-project-summary', packVersion: '1.0.3' } as const;
export const AIDT_OPT_IN_SKILL_PACKS = [AIDT_PLATFORM_SKILL_PACK, AIDT_SUMMARY_SKILL_PACK] as const;

/** AIDT is available in every deployment; legacy flags no longer hide it. */
export function parseAidtModuleEnabled(_value: string | undefined): boolean {
  return isAidtModuleEnabled();
}

export function isAidtModuleEnabled(): boolean {
  return true;
}
