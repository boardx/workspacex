/**
 * `prototype-audit-metrics.mjs` 的类型声明。
 *
 * 为什么实现是 `.mjs` 而声明单列一份：这个模块要被 `prototype-audit.mjs`（playwright
 * 脚本，node 直接跑、不经打包）和 vitest 两边 import。写成 `.ts` 就得给脚本侧加一层
 * 编译；写成 `.mjs` 又让测试侧 `noImplicitAny` 判红（本次 pre-push 实测拦下）。
 * 一份 `.d.mts` 把两边都满足，且**不放宽任何编译选项**。
 */
export interface AuditNode {
  readonly x: number; readonly y: number; readonly w: number; readonly h: number;
  readonly fontSize: number; readonly clipped: boolean; readonly tag: string;
}
export interface AuditSample {
  readonly frame: { readonly w: number; readonly h: number };
  readonly nodes: readonly AuditNode[];
}
export interface MetricResult { readonly score: number; readonly note: string }
export interface MachineScore {
  readonly total: number;
  readonly parts: Readonly<Record<string, MetricResult>>;
  readonly weights: Readonly<Record<string, number>>;
}

export function contentFillRatio(sample: AuditSample): number | null;
export function inkRatio(sample: AuditSample): number | null;
export function scoreFill(sample: AuditSample): MetricResult;
export function scoreDensity(sample: AuditSample): MetricResult;
export function scoreClipping(sample: AuditSample): MetricResult;
export function scoreTypeScale(sample: AuditSample): MetricResult;
export function scoreAlignment(sample: AuditSample): MetricResult;
export function machineScore(sample: AuditSample, only?: readonly string[] | null): MachineScore;

export function assertNoClipping(sample: AuditSample): void;
