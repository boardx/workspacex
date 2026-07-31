export interface NamingViolation {
  readonly pattern: string;
  readonly line: number;
  readonly text: string;
  readonly file?: string;
}

export declare const FORBIDDEN_NAME_SOURCES: ReadonlyArray<{ readonly name: string; readonly source: string }>;

export declare function scanTextForForbiddenNames(text: string): NamingViolation[];

export declare function scanTreesForForbiddenNames(
  roots: readonly string[],
  excludeFiles?: readonly string[],
): NamingViolation[];
