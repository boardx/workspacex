/**
 * 三类容器 → 它的 1:1 子类型表（F116 / U-9 裁 A 的落地形状）。
 *
 * ## 为什么这个映射住在 domain 而不是仓储里
 *
 * 与 `projects-column-set.ts` 同一条理由：它是**裁决的形状**，不是某次查询的细节。
 * 「工作坊的行为住在 `workshops`」这句话一旦只存在于一条 SQL 的字符串拼接里，
 * 下一个人加第四类容器时不会有任何东西提醒他这里还有一处要改——
 * 而 `satisfies Record<ProjectKind, string>` 会让那次遗漏变成编译错误。
 *
 * ⚠ 表名**不是**动态拼出来的（`${kind}s` 之类）：`research_project → research_projects`
 *   碰巧成立，`user_insight → user_insights` 也碰巧成立，而 `workshop → workshops`
 *   与判别列常量的对应关系纯属巧合。拼出来的名字在加第四类时会静默指向一张不存在的表。
 */
import type { ProjectKind } from "./create-project-rules";

export const SUBTYPE_TABLE = {
  workshop: "workshops",
  research_project: "research_projects",
  user_insight: "user_insights",
} as const satisfies Record<ProjectKind, string>;

export type SubtypeTable = (typeof SUBTYPE_TABLE)[ProjectKind];

/** 三张子表的表名集合。用于「除这三张之外没有第四张被写过」这类断言。 */
export const SUBTYPE_TABLES = Object.values(SUBTYPE_TABLE) as readonly SubtypeTable[];
