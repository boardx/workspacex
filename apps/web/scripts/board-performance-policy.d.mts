export interface BoardPerformancePolicy {baseline: {source: string; status: string; applicableObjectCounts: number[]; coldLoadP95Ms: number; localFeedbackP95Ms: number; dragFpsMinimum: number; reconnectMs: number}; convergence: {source: string; p95Ms: number; scope: string}; unbudgetedObjectCounts: number[]}
export function boardPerformancePolicy(root: string): BoardPerformancePolicy;
export function percentile95(samples: number[]): number;
export function validateBoardPerformanceArtifact(report: unknown, policy: BoardPerformancePolicy, expectedSha: string, expectedCount: number): {valid: boolean; failures: string[]; score: null; budgetStatus: string; policy: BoardPerformancePolicy};
