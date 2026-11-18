/** AIDT is available in every deployment; legacy flags no longer hide it. */
export function parseAidtModuleEnabled(_value: string | undefined): boolean {
  return isAidtModuleEnabled();
}

export function isAidtModuleEnabled(): boolean {
  return true;
}
