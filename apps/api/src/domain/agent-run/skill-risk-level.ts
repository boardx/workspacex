/**
 * issue #2767 —— `call_skill` 的风险等级按**目标 skill**判定，唯一事实源。
 *
 * `tool-risk-tier.ts` 的 `classifyToolRisk` 把 `call_skill` 整体判成 L2——那是把
 * "调用 skill 这个动作"当成了风险单位；真正的风险单位是**被调用的那个 skill**。
 * 平台四个文档 skill（pptx/docx/xlsx/pdf-create）只在不出网的沙箱里生成一个文件
 * 给用户下载，不该走授权确认。
 *
 * 判定顺序（`packages/contracts/src/plan-permissions.ts` 头注逐字同一份说明）：
 * 1. 平台官方目录（`platform-skill-catalog.ts`，按 stableName）—— L0；
 * 2. `SKILL.md` YAML frontmatter 的 `risk_level:`（`SKILL_RISK_FRONTMATTER_KEY`）——
 *    值必须是 `ToolRiskLevel` 之一，解析失败/不认识的值按"未声明"处理；
 * 3. 都没有 ⇒ `SKILL_RISK_DEFAULT_LEVEL`（今天是 `L1`）。
 *
 * `classifyToolCallRisk` 是这份判定与既有 `classifyToolRisk`（非 `call_skill` 工具，
 * 固定白名单，I-1 不变）之间的唯一入口：`tool-permission-gate.ts` 只应该调这一个
 * 函数，不应该自己判断"这次中断是不是 call_skill"。
 */
import type { ToolRiskLevel } from "@repo/contracts/plan-permissions";
import { SKILL_RISK_DEFAULT_LEVEL, ToolRiskLevel as ToolRiskLevelSchema } from "@repo/contracts/plan-permissions";
import { PLATFORM_SKILL_RISK_LEVELS } from "../skill/platform-skill-catalog";
import { classifyToolRisk } from "./tool-risk-tier";

/** `call_skill` 这一个工具名——`classifyToolCallRisk` 只对它才走 skill 判定，
 *  其余工具原样委托给 `classifyToolRisk`。字面量与 `@repo/contracts/deep-agent-hitl`
 *  的 `DEEP_AGENT_HITL_TOOL_NAME` 逐字相同，这里不 import 那个包只是为了不让
 *  `domain` 层再多背一个跨包依赖——两处都是历史事实（真实工具名），不是设计选择，
 *  值本身已经由 `deep-agent-hitl.test.ts` 的跨语言门控钉死。 */
const CALL_SKILL_TOOL_NAME = "call_skill";

export interface SkillRiskInput {
  readonly stableName: string;
  readonly content: string;
}

export interface SkillRiskEntry {
  readonly stableName: string;
  readonly riskLevel: ToolRiskLevel;
}

/**
 * 从 `SKILL.md` 正文里抠 `risk_level:` 这一个 YAML frontmatter 字段。
 *
 * ⚠ 有意与 `apps/api/src/application/skill-import/discover-skills-from-url.ts` 的
 * `parseSkillFrontmatter` 结构雷同（同样只解析一个平铺字符串字段，不是通用 YAML
 * 解析器）而不是 import 它——那个函数在 `application` 层，`domain` 不得 import
 * `application`（`lint-arch-deps.mjs`，ADR-020）。两行正则重复一次，比为了共享
 * 两行代码而破坏分层方向更便宜；两处解析的字段不同（`name`/`description` vs
 * `risk_level`），本来就不是同一份事实的两份声明。
 */
function parseFrontmatterRiskLevel(content: string): string | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (match === null) return undefined;
  const body = match[1] ?? "";
  for (const line of body.split(/\r?\n/)) {
    const kv = /^risk_level:\s*(.*)$/.exec(line.trim());
    if (kv === null) continue;
    let value = (kv[1] ?? "").trim();
    if (value.length >= 2) {
      const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
      if (quoted) value = value.slice(1, -1);
    }
    return value;
  }
  return undefined;
}

/** 单个 skill 的风险等级，按上面文件头注的三级判定顺序。 */
export function resolveSkillRiskLevel(skill: SkillRiskInput): ToolRiskLevel {
  const platformLevel = PLATFORM_SKILL_RISK_LEVELS.get(skill.stableName);
  if (platformLevel !== undefined) return platformLevel;
  const declared = parseFrontmatterRiskLevel(skill.content);
  const parsed = ToolRiskLevelSchema.safeParse(declared);
  return parsed.success ? parsed.data : SKILL_RISK_DEFAULT_LEVEL;
}

/** 批量版本——`execute-run.ts` 在拿到本次 run 挂载的全部 skill 正文后调用一次，
 *  结果贯穿这次 run 的 HITL 判定与内核投影，避免每次中断都重新解析全部正文。 */
export function resolveSkillRiskLevels(skills: readonly SkillRiskInput[]): readonly SkillRiskEntry[] {
  return skills.map((skill) => ({ stableName: skill.stableName, riskLevel: resolveSkillRiskLevel(skill) }));
}

/**
 * 一次工具调用的风险等级。非 `call_skill` ⇒ 原样委托 `classifyToolRisk`（既有
 * 固定白名单，行为逐字不变）。`call_skill` ⇒ 按 `skillStableName` 在 `skillRisks`
 * 里查——**查不到（包括 `skillStableName` 缺席）一律 L2**：I-1 的"没有例外"延伸到
 * 这里就是"认不出目标是谁的调用不能被默认放行"，不是"默认最宽松地放行"。
 */
export function classifyToolCallRisk(
  call: { readonly toolName: string; readonly skillStableName?: string | null },
  skillRisks: readonly SkillRiskEntry[],
): ToolRiskLevel {
  if (call.toolName !== CALL_SKILL_TOOL_NAME) return classifyToolRisk(call.toolName);
  const stableName = call.skillStableName;
  if (stableName === undefined || stableName === null || stableName.trim() === "") return "L2";
  const found = skillRisks.find((entry) => entry.stableName === stableName);
  return found?.riskLevel ?? "L2";
}

/** 供网关投影用：本次 run 挂载集合里，等级为 L2 的 skill 的 stableName 列表——
 *  这就是要放进 `configurable.hitl_skill_names` 让内核 interrupt 的名单。 */
export function selectL2SkillNames(skillRisks: readonly SkillRiskEntry[]): readonly string[] {
  return skillRisks.filter((entry) => entry.riskLevel === "L2").map((entry) => entry.stableName);
}
