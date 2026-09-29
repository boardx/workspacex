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
    skillSlugs: ["user-research-planning", "interview-synthesis", "design-methods", "maau-canvas", "maau-venture-valuation"],
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

export type HiddenSkillReason = "auto-triggered" | "admin-area" | "work-stack-catalog";

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
  // Phase 20 CT01 —— D002 研究线 Work Skill 内容包（`skills/work-research/`，均带
  // `metadata.work`）。这些不是本表管的「三入口」消费级 skill 库条目：它们经
  // Work Stack v2 目录（`/skill?screen=work-catalog`，WS01-05）单独浏览/导入/管理，
  // 有自己的通道（candidate/verified/deprecated）与就绪性面板。归到这里只是让本文件的
  // 门控（「skills/ 下每个 SKILL.md 必须恰好分配一次」）通过，不代表它们被下线。
  { slug: "data-exploration", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "data-storytelling", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "data-validation", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "data-visualization-report", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "decision-brief", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "enterprise-search", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "evidence-review", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "executive-briefing", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "knowledge-capture", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "knowledge-synthesis-review", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "market-sizing", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "research-synthesis", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "risk-assessment", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "scientific-research-planning", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "sql-query", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "statistical-analysis", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "task-extraction", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "trend-analysis", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  // Phase 20 CT07 —— D005 销售线 Work Skill 内容包（`skills/work-sales/`，均带
  // `metadata.work`）。同 CT01 理由：经 Work Stack v2 目录单独浏览/导入/管理，不进三入口。
  // `risk-assessment`（S010）已由 CT01 登记（同 slug，是另一条内容线独立分发的 pack 副本），
  // 本表按 slug 去重，不重复登记同一 slug 两次。
  { slug: "customer-intelligence", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "account-tiering", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "account-planning", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "prospecting", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "lead-triage", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "outreach", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "sales-call-summary", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "opportunity-update", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "pipeline-review", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "forecasting", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "close-plan", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "crm-hygiene", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "proposal-builder", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "customer-health", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "renewal-radar", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "customer-research", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
  { slug: "meeting-prep", reason: "work-stack-catalog", note: "Work Stack 目录浏览，见 /skill?screen=work-catalog" },
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
