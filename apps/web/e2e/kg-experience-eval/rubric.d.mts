export declare const REPO_ROOT: string;
export declare const EVIDENCE_DIR: string;
export declare const LOCK_FILE: string;
export declare const PASS_MARK: number;
export declare const DIMENSIONS: Record<string, { readonly name: string; readonly what: string }>;
export declare function rubricFiles(): string[];
export declare function rubricHash(root?: string): string;
export declare const CHECK_TITLE: RegExp;
export interface ScoredCheck { readonly dim: string; readonly id: string; readonly passed: boolean }
export interface ScoredDim {
  readonly dim: string; readonly name: string; readonly what: string;
  readonly passed: number; readonly total: number; readonly score: number;
}
export declare function scoreChecks(checks: readonly ScoredCheck[]): { dims: ScoredDim[]; total: number };
