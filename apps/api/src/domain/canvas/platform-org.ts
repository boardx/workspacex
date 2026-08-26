/**
 * 平台模板库所属的组织 id —— **本仓这个字面量的唯一事实源**。
 *
 * 人类 2026-08-26 裁决「模板是给所有组织使用的」，形态为 B2（全局母版 + 用时 fork）。
 * 母版就是 `canvas_templates` 里 `org_id = PLATFORM_ORG_ID` 的真实行。
 *
 * ⚠ 这个字符串同时出现在**迁移的 RLS 策略里**（`canvas_templates_platform_read` 的
 *   `USING (org_id = 'org-platform')`，SQL 里没法 import 常量）。两处必须相等，
 *   而「必须相等」这四个字本身不会让任何东西变红——所以有一条测试**从库里读出策略原文**
 *   与本常量比对（`tests/canvas/platform-org-single-source.test.ts`）。
 *   本项目已五次因「同一事实声明在两处」漂移，这里是第六处，用机械门控收口而不是靠注释。
 */
export const PLATFORM_ORG_ID = "org-platform";

/** 这一行是不是平台母版（对任何真实组织而言都是只读的）。 */
export function isPlatformOwned(orgId: string): boolean {
  return orgId === PLATFORM_ORG_ID;
}
