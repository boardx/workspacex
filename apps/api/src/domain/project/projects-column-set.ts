/**
 * I-P33 的判定：`projects` 的列集合是一个**封闭清单**。
 *
 * 纯函数，最内层。没有时钟、没有 I/O、不认识 PostgreSQL —— 它只回答
 * 「给我一组列名，它和契约允许的那一组相等吗」。真库的列名怎么读出来是测试的事。
 *
 * ## 为什么判定要抽成函数，而不是写死在测试体里
 *
 * 写死在测试体里的判定**没有反证**：一个「永远说 ok」的实现让主门永远绿，
 * 而主门是绿的，没有人会去读它。抽成函数之后可以喂**伪造的**列集合进来，
 * 断言它确实会红 —— 这是本仓已经栽过九次的那个形状
 * （`0008-f06:29-31` 拒绝「永远说 open 的可空查表」是同一条）。
 *
 * ## 为什么是白名单等值，不是黑名单
 *
 * `files` 束的 N-4 是黑名单（断言某两列不存在）。黑名单挡不住**下一个没被想到的名字**：
 * `agenda_segment_id` 被挡住了，`current_segment_id` 没有。
 * I-P33 要挡的正是「下一个人顺手加一列」，所以只能是集合相等。
 *
 * ## 它挡不住什么（诚实说明）
 *
 * 白名单常量与迁移是两处，改白名单就能让门控闭嘴。所以它的作用一半是社会性的：
 * 加列的人必须**同时改两处**，改动出现在 diff 的显眼处。
 * 真正的门是签核（`contracts/project/design-signoff.md` 的交叉约束表）。
 * 为了让「偷偷改白名单」也留下痕迹，`PROJECTS_COLUMNS` 另有两条意图断言：
 * 长度恒为 5，且**逐值**等于契约 `project.Project` 的字段（camelCase → snake_case）。
 */
import { project } from "@repo/contracts";

/**
 * 恰好这五列。三类容器共用的只有「容器身份 + 组织归属 + 状态」。
 *
 * ⚠ 任何把工作坊专属字段（议程环节、分组、蓝本引用、会前/现场/会后……）
 *   加进来的改动都违反 Q-12 裁决 C —— 那些字段属于 `workshops` 子类型表。
 */
export const PROJECTS_COLUMNS = ["id", "org_id", "name", "status", "kind"] as const;

export type ProjectsColumn = (typeof PROJECTS_COLUMNS)[number];

export interface ProjectsColumnSetVerdict {
  /** 集合相等 ⇔ ok。不是「包含」，也不是「不含黑名单」。 */
  ok: boolean;
  /** 出现在真库里、不在白名单里的列 —— 「顺手加的那一列」就落在这里。 */
  extra: string[];
  /** 白名单里有、真库里没有的列 —— 迁移没跑或被回退时落在这里。 */
  missing: string[];
}

/**
 * ⚠ 参数是 `readonly string[]` 而不是 `ProjectsColumn[]`：它要能接受**任何**字符串。
 * 收窄成联合类型会让「喂一个非法列名进来」变成编译错误，反证也就写不出来了。
 */
export function checkProjectsColumnSet(actual: readonly string[]): ProjectsColumnSetVerdict {
  const allowed = new Set<string>(PROJECTS_COLUMNS);
  const seen = new Set<string>(actual);
  const extra = [...seen].filter((c) => !allowed.has(c)).sort();
  const missing = [...allowed].filter((c) => !seen.has(c)).sort();
  return { ok: extra.length === 0 && missing.length === 0, extra, missing };
}

/**
 * 契约侧字段名（camelCase）→ 列名（snake_case）。
 *
 * 存在的理由只有一个：让「契约 `Project` 的字段集合」与「白名单」可以**机械比对**。
 * 少了它，两处各自成立，而它们本该是同一个事实的两种拼写。
 */
export function contractFieldToColumn(field: string): string {
  return field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** 契约 `project.Project` 声明的列集合。⚠ 不是第二份白名单，是白名单的**对照物**。 */
export function contractProjectColumns(): string[] {
  return Object.keys(project.Project.shape).map(contractFieldToColumn).sort();
}
