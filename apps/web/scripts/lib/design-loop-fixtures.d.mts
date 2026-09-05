/** 类型声明：给 `e2e/design-loop-responsive.spec.ts`（TS）导入同名 `.mjs` 夹具用；实现见 `.mjs`。 */
import type { Page } from "@playwright/test";

export const NOW: string;
export const DRAFTS: readonly Record<string, unknown>[];
export const INBOX_ITEMS: readonly Record<string, unknown>[];
export const DESIGN_PROJECTS: readonly Record<string, unknown>[];
export function routeDrafts(page: Page, opts: { empty: boolean }): Promise<void>;
export function routeInbox(page: Page, opts: { empty: boolean }): Promise<void>;
export function routeDesignWorkbench(
  page: Page,
  opts?: { empty?: boolean; slow?: boolean; failList?: boolean },
): Promise<void>;
