export const observationCategories: Readonly<Record<string, string>>;
export function observationMode(value?: string): 'all' | 'functional';
export function categoryEnabled(category: string, mode?: 'all' | 'functional'): boolean;
export function observationArtifactKinds(mode?: 'all' | 'functional'): {report: string; bundle: string};
