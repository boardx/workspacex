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
 * ⚠ 表名**不是**动态拼出来的（`${kind}s` 之类）：`workshop → workshops` 碰巧成立，
 *   `general → general_projects` 就不成立。拼出来的名字在加新类时会静默指向一张不存在的表。
 *
 * #4615（2026-09-29 人类裁决推翻 Q-12）：原 `research_project` / `user_insight` 两类并入
 * `general`，子表 `research_projects` 改名 `general_projects`、`user_insights` 删除
 * （迁移 `20260929050000_pw_w1_general_project_kind.sql`）。
 */
import type { ProjectKind } from "./create-project-rules";

export const SUBTYPE_TABLE = {
  workshop: "workshops",
  general: "general_projects",
} as const satisfies Record<ProjectKind, string>;

export type SubtypeTable = (typeof SUBTYPE_TABLE)[ProjectKind];

/** 子表的表名集合。用于「除这些之外没有别的子表被写过」这类断言。 */
export const SUBTYPE_TABLES = Object.values(SUBTYPE_TABLE) as readonly SubtypeTable[];
