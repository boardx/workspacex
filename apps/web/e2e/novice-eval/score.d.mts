/** 类型声明：给 `novice.eval.ts` 导入同名 `.mjs` 用；实现与取值见 `score.mjs`。 */
export type Dim = "task" | "steps" | "clutter" | "jargon" | "states" | "access";
export interface Check { readonly id: string; readonly dim: Dim; readonly pass: boolean; readonly detail: string }
export const DIMENSIONS: Readonly<Record<Dim, { readonly weight: number; readonly label: string }>>;
export const STEP_BUDGET: Readonly<Record<"create" | "modify" | "undo" | "preview" | "share" | "restore", number>>;
export const CLUTTER_BUDGET: Readonly<Record<"workbench" | "newDialog" | "detail", number>>;
export const JARGON: readonly string[];
export function score(checks: readonly Check[]): { readonly score: number; readonly rows: readonly { dim: Dim; label: string; pass: number; total: number; ratio: number; failed: Check[] }[] };
export function report(result: ReturnType<typeof score>): string;
