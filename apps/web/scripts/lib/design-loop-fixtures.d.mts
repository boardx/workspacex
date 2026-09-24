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
  opts?: { empty?: boolean; slow?: boolean; failList?: boolean; extraProjects?: readonly Record<string, unknown>[] },
): Promise<FixtureProject[]>;

/** `routeDesignWorkbench` 背后那份活数据里的一个项目（对标评测在它上面挂自己的路由）。 */
export interface FixtureProject extends Record<string, unknown> {
  id: string; frames: string[]; prototype: (unknown | null)[]; frameNotes: string[]; frameLinks?: unknown[][]; updatedAt: string;
}
