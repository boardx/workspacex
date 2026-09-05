/**
 * 平台官方 skill 目录规格的唯一事实源（issue #2767）。
 *
 * 这四行此前只活在 `infrastructure/skill/ensure-platform-skill-catalog.ts` 的
 * `OFFICIAL_SKILLS` 里——那是对的，直到 #2767 需要在 `domain/agent-run/skill-
 * risk-level.ts` 里判断"这个 stableName 是不是平台官方文档 skill、它的风险等级是
 * 多少"。`domain` 层不得 import `infrastructure`（`lint-arch-deps.mjs`，ADR-020），
 * 于是把 `skillId`/`stableName`/`displayName`/`riskLevel` 四个**规格**字段下沉到
 * 这里；`ensure-platform-skill-catalog.ts` 反过来 import 本文件，只补上正文
 * `content`（仍从 `scripts/office-docs-skill-content.ts` 取，不搬动、不重写）。
 * 四个 skill 的名字与 id 依旧只声明这一次（本仓五次因"同一事实两处声明"漂移过，
 * 见 AGENTS.md 硬约束）。
 *
 * `riskLevel` 全部是 `L0`：四个官方 skill 只在不出网的沙箱里生成一个文件给用户
 * 下载，没有外发/不可逆动作（issue #2767 的根因结论）。
 */
import type { ToolRiskLevel } from "@repo/contracts/plan-permissions";

export interface PlatformSkillCatalogEntry {
  readonly skillId: string;
  readonly stableName: string;
  readonly displayName: string;
  readonly riskLevel: ToolRiskLevel;
}

export const PLATFORM_SKILL_CATALOG: readonly PlatformSkillCatalogEntry[] = [
  { skillId: "skill-platform-pptx-create", stableName: "pptx-create", displayName: "演示文稿生成", riskLevel: "L0" },
  { skillId: "skill-platform-docx-create", stableName: "docx-create", displayName: "Word 文档生成", riskLevel: "L0" },
  { skillId: "skill-platform-xlsx-create", stableName: "xlsx-create", displayName: "Excel 表格生成", riskLevel: "L0" },
  { skillId: "skill-platform-pdf-create", stableName: "pdf-create", displayName: "PDF 文档生成", riskLevel: "L0" },
];

/** `stableName → riskLevel` 查表，供 `skill-risk-level.ts` 判定用，避免每次都线性扫数组。 */
export const PLATFORM_SKILL_RISK_LEVELS: ReadonlyMap<string, ToolRiskLevel> = new Map(
  PLATFORM_SKILL_CATALOG.map((entry) => [entry.stableName, entry.riskLevel]),
);
