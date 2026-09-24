/** 类型声明：给 `design-parity.eval.ts` 导入同名 `.mjs` 用；实现与冻结规则见 `cases.mjs`。 */
export interface EvalCase { readonly id: string; readonly name: string; readonly brief: string; readonly device?: string }
export const EVAL_CASES: readonly EvalCase[];
export const EVAL_PROJECTS: readonly Record<string, unknown>[];
