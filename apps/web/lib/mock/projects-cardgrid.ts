/**
 * `projects` 卡片网格改版 —— UI 先行原型的 **mock 数据源**（ADR-003 / ADR-023 第 ① 件材料）。
 *
 * ⚠ **为什么单独一份 mock，而不是改生产屏 `components/projects/projects-screen.tsx`**：
 *   那是接了真实 `GET /projects` 的生产组件（F353）。它的契约类型 `ProjectListItem`
 *   只有五个字段（id/name/kind/status/readOnlyReason），**没有 tags**。签核前不许改生产屏，
 *   也不许往真实契约里编字段（本仓硬纪律：宁可少画，不编一个看起来算过的数）。
 *   这份 mock 只用来给人类看「卡片网格 + 标签过滤」的呈现效果，供束级 design-signoff.md
 *   第 ① 件裁决，**不接后端、不改生产屏、不动契约**。
 *
 * ## 字段出处分三档（签核时请对着这份表看，不是我在编）
 *
 * | 字段            | 出处                                                   | 可否直接接真 |
 * |-----------------|--------------------------------------------------------|--------------|
 * | id/name         | 契约 `ProjectListItem`                                 | ✅ 有出处    |
 * | kind            | 契约 `ProjectKind`（workshop/research_project/user_insight） | ✅ 有出处 · **可作筛选维度** |
 * | status          | 契约 `ProjectStatus`（active/archived）                | ✅ 有出处 · **可作筛选维度** |
 * | readOnlyReason  | 契约 `ProjectListItem`（null/archived/org-disabled）   | ✅ 有出处    |
 * | **tags**        | **无契约出处 —— 探索性 mock 字段**                     | ❌ 待人类 + API 契约一起裁决 |
 *
 * kind/status 的中文标签直接复用 `live-projects` 里已有的映射（同一事实源，不另抄一份）。
 */
import { PROJECT_KIND_LABEL, PROJECT_STATUS_LABEL, type ProjectListItem } from "@/lib/live-projects";

export { PROJECT_KIND_LABEL, PROJECT_STATUS_LABEL };
export type { ProjectListItem };

type Kind = ProjectListItem["kind"];
type Status = ProjectListItem["status"];

/**
 * 卡片行 = 契约五字段 + 一个**显式标注为探索性**的 `tags`。
 * `tags` 单拎出来放，不混进契约五字段里，就是为了让「哪些有出处、哪些没有」在类型层面一眼可分。
 */
export interface ProjectCardRow extends ProjectListItem {
  /** ⚠ 探索性 mock 字段，无契约出处。采纳需人类 + API 契约一起裁决（是否新增 `tags` 面）。 */
  readonly exploratoryTags: readonly string[];
}

/**
 * 探索性标签词表 —— 只是把人类「想按什么筛」的直觉画出来给他看，**不代表契约会长这些字段**。
 * 刻意避开生产屏文件头点名「没有出处、故意不补」的 owner / priority / readiness /
 * stageProgress / schedule —— 那几个是被否掉的编字段，不能借标签之名复活。
 */
export const EXPLORATORY_TAGS = [
  "客户共创",
  "内部演练",
  "本季重点",
  "跨团队",
  "已交付",
  "待复盘",
] as const;

/**
 * 14 条 mock，覆盖三种 kind、两种 status、以及 readOnlyReason 的三种取值。
 * 数量与信息密度接近真实一屏（不是三行假数据），好让人类看出网格在真实密度下的观感。
 */
export const PROJECT_CARDS: readonly ProjectCardRow[] = [
  { id: "p-01", name: "供应链韧性工作坊", kind: "workshop", status: "active", readOnlyReason: null, exploratoryTags: ["客户共创", "本季重点"] },
  { id: "p-02", name: "Q3 用户流失归因研究", kind: "research_project", status: "active", readOnlyReason: null, exploratoryTags: ["本季重点", "跨团队"] },
  { id: "p-03", name: "新会员开卡体验洞察", kind: "user_insight", status: "active", readOnlyReason: null, exploratoryTags: ["客户共创"] },
  { id: "p-04", name: "门店动线优化共创", kind: "workshop", status: "active", readOnlyReason: null, exploratoryTags: ["客户共创", "跨团队"] },
  { id: "p-05", name: "AI 客服满意度回访", kind: "user_insight", status: "active", readOnlyReason: null, exploratoryTags: ["待复盘"] },
  { id: "p-06", name: "增长实验方法论内训", kind: "workshop", status: "active", readOnlyReason: null, exploratoryTags: ["内部演练"] },
  { id: "p-07", name: "退货率下降驱动因素", kind: "research_project", status: "active", readOnlyReason: null, exploratoryTags: ["本季重点"] },
  { id: "p-08", name: "会员分层策略共创", kind: "workshop", status: "active", readOnlyReason: null, exploratoryTags: ["客户共创", "跨团队", "本季重点"] },
  { id: "p-09", name: "小程序首页改版洞察", kind: "user_insight", status: "active", readOnlyReason: null, exploratoryTags: [] },
  { id: "p-10", name: "2025 年度品牌资产盘点", kind: "research_project", status: "active", readOnlyReason: null, exploratoryTags: ["已交付", "待复盘"] },
  { id: "p-11", name: "旧渠道合作复盘工作坊", kind: "workshop", status: "archived", readOnlyReason: "archived", exploratoryTags: ["已交付"] },
  { id: "p-12", name: "去年双十一战报研究", kind: "research_project", status: "archived", readOnlyReason: "archived", exploratoryTags: ["已交付", "待复盘"] },
  { id: "p-13", name: "停用组织的历史洞察", kind: "user_insight", status: "active", readOnlyReason: "org-disabled", exploratoryTags: [] },
  { id: "p-14", name: "早期定价假设访谈", kind: "research_project", status: "archived", readOnlyReason: "archived", exploratoryTags: ["已交付"] },
];

export const KINDS: readonly Kind[] = ["workshop", "research_project", "user_insight"];
export const STATUSES: readonly Status[] = ["active", "archived"];

export function readOnlyLabel(reason: ProjectListItem["readOnlyReason"]): string | null {
  if (reason === null) return null;
  return reason === "archived" ? "只读 · 已归档" : "只读 · 组织已停用";
}
