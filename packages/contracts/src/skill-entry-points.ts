/**
 * backlog E6 —— Skill 目录收敛成三个面向用户的入口（人类决策：方案 B「按场景」）。
 *
 * **唯一事实源**：哪个平台 skill（按 `stableName`，即 `skills/<pack>/<skill>/SKILL.md`
 * frontmatter 的 `name`，也是 starter-pack JSON 里的 `stableName`）归哪个入口、哪些是
 * 自动触发的底层能力不作为入口展示，只在这里声明一次。
 *
 * 门控：`packages/contracts/tests/skill-entry-points.test.ts` 扫仓库 `skills/` 下全部
 * SKILL.md，每个 slug 必须**恰好**出现在一个入口或 `HIDDEN_PLATFORM_SKILLS` 中；未分配的
 * 新 skill、本表写了但仓库不存在的 slug 都判失败。
 *
 * ⚠ 本表只影响**展示**（Skill 库默认视图），不参与 skill 解析 / 自动触发 / 挂载：
 *   隐藏的 skill 在库里、在运行时照常可用。
 */

export type SkillEntryPointId = "research-and-read" | "user-and-business-insight" | "write-for-others";

export interface SkillEntryPoint {
  readonly id: SkillEntryPointId;
  readonly label: string;
  readonly promise: string;
  readonly skillSlugs: readonly string[];
}

export const SKILL_ENTRY_POINTS: readonly SkillEntryPoint[] = [
  {
    id: "research-and-read",
    label: "查资料·读材料",
    promise: "丢进来文件、录音或问题，给你有出处的答案",
    skillSlugs: ["web-research", "data-analysis", "meeting-minutes"],
  },
  {
    id: "user-and-business-insight",
    label: "用户与业务洞察",
    promise: "从访谈和讨论得出可行动的判断",
    skillSlugs: ["user-research-planning", "interview-synthesis", "maau-canvas", "maau-venture-valuation"],
  },
  {
    id: "write-for-others",
    label: "写给别人看",
    promise: "周报、公告、会议材料、海报、网页",
    skillSlugs: [
      "project-status-report",
      "internal-communications",
      "meeting-preparation",
      "visual-content",
      "web-artifact",
    ],
  },
];

export type HiddenSkillReason = "auto-triggered" | "admin-area";

export interface HiddenPlatformSkill {
  readonly slug: string;
  readonly reason: HiddenSkillReason;
  readonly note: string;
}

/** 不作为入口列出的平台 skill——仍然存在、仍可被自动触发 / 在管理区找到。 */
export const HIDDEN_PLATFORM_SKILLS: readonly HiddenPlatformSkill[] = [
  { slug: "document-understanding", reason: "auto-triggered", note: "上传文件时自动读取" },
  { slug: "audio-transcription", reason: "auto-triggered", note: "上传录音时自动转写" },
  { slug: "knowledge-grounded-answer", reason: "auto-triggered", note: "回答时自动引用知识库出处" },
  { slug: "diagram-and-canvas", reason: "auto-triggered", note: "需要画图 / 画布时自动调用" },
  { slug: "data-visualization", reason: "auto-triggered", note: "分析结果需要图表时自动调用" },
  { slug: "skill-authoring", reason: "admin-area", note: "在「我的 skill」/ 管理区使用" },
];

/** slug → 所属入口 id；隐藏的返回 "hidden"；不在表里的返回 null（非平台 skill）。 */
export function entryPointOf(slug: string): SkillEntryPointId | "hidden" | null {
  for (const entry of SKILL_ENTRY_POINTS) if (entry.skillSlugs.includes(slug)) return entry.id;
  if (HIDDEN_PLATFORM_SKILLS.some((h) => h.slug === slug)) return "hidden";
  return null;
}

/** 表里声明过的全部 slug（保留重复——门控靠它查重）。 */
export function allAssignedSkillSlugs(): readonly string[] {
  return [...SKILL_ENTRY_POINTS.flatMap((e) => e.skillSlugs), ...HIDDEN_PLATFORM_SKILLS.map((h) => h.slug)];
}
