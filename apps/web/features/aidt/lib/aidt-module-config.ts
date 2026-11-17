/** Explicit build-time opt-in; teaching routes must not change the default product. */
export function parseAidtModuleEnabled(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

export function isAidtModuleEnabled(): boolean {
  // Use the direct property access so Next can inline the public build-time flag.
  return parseAidtModuleEnabled(process.env.NEXT_PUBLIC_ENABLE_AIDT);
}
