/**
 * issue #3440 —— 四个平台官方文档 skill（pdf/docx/xlsx/pptx-create）的「已声明工具
 * 清单」+「(skill_name, tool_name) 授权寻址」的唯一事实源。
 *
 * ## 为什么需要这份清单（不是猜的，从真实执行链路取证）
 *
 * #3401/#3403 的 devapp 真机证据（`docs/design/standard-capabilities/evidence/
 * issue-3401/baseline1-timeline.json`、`b21_1-timeline.json` 等）逐字取出四个文档
 * skill 在原生模式（`native_graph.py`）下实际调用的工具名全集：
 *   `read_file`（读 `/skills/<name>/SKILL.md` 与 `references/*.md`）、
 *   `write_file`（把模型现写的生成脚本落到 `/workspace/*.js`）、
 *   `execute`（跑该脚本，以及跑 skill 自带的 `/skills/<name>/scripts/render-office.py`）、
 *   `edit_file`（#3401 `b21_1` 证据：迭代修正已生成脚本时用）。
 * legacy（非原生）模式下这四个 skill 是通过 `call_skill` 这一个工具整体调用的
 * （`deep_agent_service/tools.py` 的唯一有副作用工具）。
 *
 * ## 为什么清单里只有 `execute`（和 legacy 的 `call_skill`）真正参与授权判定
 *
 * `tool-risk-tier.ts` 是风险分级的唯一事实源：`read_file` 是 L0，`write_file`/
 * `edit_file` 是 L1——两档都不会触发 `awaiting_tool_permission`（只有 L2 会）。
 * 四个文档 skill 清单里唯一的 L2 工具是 `execute`（原生模式）与 `call_skill`
 * （legacy 模式，`classifyToolCallRisk` 按目标 skill 判）。本文件因此只对这两个
 * 工具名计算"是否可归因到某个已声明清单里的 skill"，其余工具名不需要判定——不是
 * 遗漏，是它们本就不在 L2 那一档，见上面的分级表。
 *
 * ## (skill_name, tool_name) 寻址 —— #3221 的局部、范围受限修复
 *
 * #3221 的根因：`tool-permission-gate.ts` 此前用裸 `toolName`（对所有 `call_skill`
 * 调用都是同一个字符串）去查/写授权，于是批准一个 skill 会连带放行本 run 内所有其它
 * L2 skill。本文件只把这条修法应用在四个已知可信的文档 skill 上（`resolveGrantAddress`
 * 把地址从裸 `"call_skill"` 收紧成 `"call_skill:pdf-create"` 这样的 skill 限定串）——
 * 不是 #3221 的全量修复：其余 skill 之间是否互相泄漏授权，本文件不处理，仍是已知、
 * 留档的范围外问题。
 *
 * ## 原生模式的归因边界（诚实写清楚，不是缺陷）
 *
 * 原生模式的 `execute` 中断天然不带"这次调用属于哪个 skill"的字段（`native_graph.py`
 * 的 `interrupt_on` 是每个 run 一张静态的 `{toolName: boolean}` 表，不是逐次调用的
 * 判定——#3437 头注已经详细论证过这一点）。`resolveNativeExecuteAttribution` 只在
 * **本次 run 挂载的 skill 集合里恰好只有一个是这四个锁定 skill 之一、且没有挂载任何
 * 其它非 L0 skill** 时才把 `execute` 归因给那个 skill；不满足就返回 `null`（不归因，
 * 一律照旧询问）。
 *
 * 这个边界是刻意的、经过反证的：#3437 用 devapp 真机 run 34601392370 证明了典型
 * devapp 账号一次原生会话会挂载 21 个 skill（4 个平台官方 + 17 个默认 L1 的普通
 * skill），"全部挂载 skill 都符合条件"这个前提在生产条件下几乎恒为 false——本文件
 * 不假装能绕开这一点，`resolveNativeExecuteAttribution` 在那种典型条件下同样返回
 * `null`，`execute` 依旧每次都问。同一份证据里 `node assistant-capabilities.js`
 * （模型为"顺便总结一下你能做什么"这类混合请求自己写的脚本，跑在 `/workspace` 而非
 * 任何 skill 目录下）在这份清单机制下也不会被误放行：它既不满足"唯一挂载锁定
 * skill"的条件（真实 run 混挂了非 L0 skill），也不该满足——这正是 #3440 要求必须
 * 用断言守住的安全边界。
 */
import type { SkillRiskEntry } from "./skill-risk-level";

/** 四个平台官方文档 skill 的 stableName——与 `platform-skill-catalog.ts` 逐字同一份值，
 *  不在这里重新声明第二次；只挑出锁定子集。 */
export const DOCUMENT_GENERATION_SKILL_NAMES = [
  "pdf-create", "docx-create", "xlsx-create", "pptx-create",
] as const;
export type DocumentGenerationSkillName = (typeof DOCUMENT_GENERATION_SKILL_NAMES)[number];

const DOCUMENT_GENERATION_SKILL_NAME_SET: ReadonlySet<string> = new Set(DOCUMENT_GENERATION_SKILL_NAMES);

export function isDocumentGenerationSkillName(name: string): name is DocumentGenerationSkillName {
  return DOCUMENT_GENERATION_SKILL_NAME_SET.has(name);
}

/**
 * 四个文档 skill 各自声明的工具清单——逐字取自 #3401/#3403 真实执行链路证据（见本文件
 * 头注）。四个 skill 目前共用同一份清单（都是"读 SKILL.md → 写生成脚本 → 执行 → 视需要
 * 编辑重试"这同一套流程），不是巧合合并——分开维护四份相同的清单只会制造第二份事实源。
 */
export const DOCUMENT_GENERATION_TOOL_MANIFEST: readonly string[] = [
  "read_file", "write_file", "execute", "edit_file",
];

/** legacy 模式（`call_skill`）里真正参与授权判定的工具名。 */
export const CALL_SKILL_TOOL_NAME = "call_skill";
/** 原生模式里参与授权判定的工具名（清单里唯一的 L2 工具，见头注分级表）。 */
export const NATIVE_L2_MANIFEST_TOOL_NAME = "execute";

/**
 * composer 开关「自动批准文档生成所需权限」落地成的组织级 standing grant 地址
 * （`tool_permission_grants.tool_name` 的值）——刻意与任何真实工具名不同形（含冒号），
 * 不会与任何工具的裸授权地址碰撞。
 */
export const DOCUMENT_GENERATION_AUTO_APPROVE_GRANT_ADDRESS = "document_generation:auto_approve";

/**
 * legacy `call_skill` 中断的授权寻址：目标 skill 在锁定清单内 ⇒ 收紧成
 * `call_skill:<stableName>`（#3221 的局部修复，见头注）；否则 `null`（不归因，
 * 调用方应退回裸 `toolName` 寻址，行为与本 feature 之前逐字相同）。
 */
export function resolveCallSkillGrantAddress(skillStableName: string | null | undefined): string | null {
  if (typeof skillStableName !== "string" || !isDocumentGenerationSkillName(skillStableName)) return null;
  return `${CALL_SKILL_TOOL_NAME}:${skillStableName}`;
}

/**
 * 原生模式 `execute` 中断的归因：本次 run 挂载的 skill 集合里锁定清单命中且仅命中
 * 一个、且没有挂载任何其它非 L0 skill 时，返回那个 skill 的 stableName；否则 `null`
 * （不归因）。见头注"原生模式的归因边界"一节——这是刻意、经反证的保守判定，不是
 * 简化省略。
 */
export function resolveNativeExecuteAttribution(
  skillRisks: readonly SkillRiskEntry[],
): DocumentGenerationSkillName | null {
  const lockedMounted = skillRisks.filter((entry) => isDocumentGenerationSkillName(entry.stableName));
  if (lockedMounted.length !== 1) return null;
  const hasOtherNonL0 = skillRisks.some(
    (entry) => !isDocumentGenerationSkillName(entry.stableName) && entry.riskLevel !== "L0",
  );
  if (hasOtherNonL0) return null;
  return lockedMounted[0]!.stableName as DocumentGenerationSkillName;
}

/**
 * 原生模式 `execute` 归因命中后的授权寻址：`execute:<stableName>`。与
 * `resolveCallSkillGrantAddress` 的地址形状一致（`<toolName>:<skillStableName>`），
 * 两条路径共用同一套读/写代码，不需要 `tool-permission-gate.ts` 区分 legacy/native。
 */
export function resolveNativeExecuteGrantAddress(skillStableName: DocumentGenerationSkillName): string {
  return `${NATIVE_L2_MANIFEST_TOOL_NAME}:${skillStableName}`;
}

/**
 * `tool-permission-gate.ts` 的唯一入口：给定这次中断的 `toolName` +（legacy 才有的）
 * `skillStableName` + 本次 run 挂载的 `skillRisks`，算出"这次调用是否可归因到四个
 * 锁定文档 skill 之一"，能就返回收紧后的授权地址，不能就返回 `null`
 * （调用方据此退回裸 `toolName`，即"清单之外一律照旧"——I-1 的延伸）。
 */
export function resolveDocumentGenerationGrantAddress(
  toolName: string,
  skillStableName: string | null | undefined,
  skillRisks: readonly SkillRiskEntry[],
): string | null {
  if (toolName === CALL_SKILL_TOOL_NAME) return resolveCallSkillGrantAddress(skillStableName);
  if (toolName === NATIVE_L2_MANIFEST_TOOL_NAME) {
    const attributed = resolveNativeExecuteAttribution(skillRisks);
    return attributed === null ? null : resolveNativeExecuteGrantAddress(attributed);
  }
  return null;
}
