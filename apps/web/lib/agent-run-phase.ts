/**
 * `deriveRunPhaseLabel` —— gap #8（人类 2026-08-22 devapp 实测，未修复）：长任务
 * 「正在思考…」卡片全程只有一个计时器，猜不出卡在哪一步。
 *
 * ## 数据来源：没有新接口
 *
 * `GET /api/agent-runs/{id}` 早就在 `AgentRunView.steps` 里逐步写下每个已完成的
 * step（`packages/contracts/src/wave2-runtime.ts` 的 `AgentRunStep`／`AgentRunStepKind`：
 * `accepted` / `context_built` / `model_called` / `tool_call` / `chat_writeback`）——
 * `agent-tool-chain.tsx` 已经在消费同一个数组画工具链。这里只是另一种读法：不逐条
 * 列出，只取**最新一条**，把它的 `kind`（`tool_call` 时再看 `toolName`）翻译成
 * 用户可读的阶段文案。
 *
 * ## 为什么是「最新一条已完成 step」而不是「当前正在跑的 step」
 *
 * `execute-run.ts` 只在一个 step **结束**时才 `record` 它——没有「进行中」的行。
 * 轮询中途读到的 steps 数组永远是「目前为止已经跑完的步骤」。用最新一条的 kind
 * 做阶段提示是一个诚实的近似（"我们刚做完 X，大概率正在做 X 之后的事"），不是
 * 伪造一个「现在正在做什么」的精确断言——契约里没有这个字段，编一个出来比不显示
 * 更糟（活体既有纪律：不合成、不兜底，见 `lib/agent-run.ts` 文件头）。
 *
 * ## 写死的映射表，不做动态统计/配置化（人类已确认，产品决策）
 *
 * 覆盖当前契约里全部 5 个 `kind`；`tool_call` 再按 `toolName` 细分
 * `list_org_skills`/`call_skill`（deep-agent 通用助手两个真实工具名，
 * 见 `apps/api/src/infrastructure/agent-run/deep-agent-model-provider.ts`），以及
 * `ls`/`glob`/`grep`/`read_file`/`write_file`/`edit_file`（`deepagents` 的
 * `FilesystemMiddleware` 内置工具名，见该模块 `harness.py` 挂载处的既有文件头
 * 记录）。未识别的 `kind`（未来契约新增值）一律落一句不特指的「正在处理…」兜底，
 * 绝不因为遇到没见过的值就报错或留空——参照同一份文件里 `hasMountedSkills` 分支
 * 的既有纪律：宁可笼统，不可编造归因。
 *
 * ## 真实工具名不在表里时，仍然回显工具名，不是一句静止不变的兜底文案
 *
 * issue #2321 追加（人类实测：`ls` → `glob` 连续两次真实工具调用，指示条全程停在
 * 同一句「正在调用工具…」69 秒不变，读起来像卡死，而不是「换了一个动作」）。
 * `DEFAULT_TOOL_PHASE`（`toolName` 为 `null`——AG-UI 事件里工具名本身缺失，没有
 * 任何真实信息可显示）与「工具名是真实字符串、只是这张写死的表还没收录它」是两件
 * 不同的事：前者只能兜底，后者手里明明有一个真实观测到的名字，兜成同一句静态文案
 * 反而把可用的信息藏起来了。`phaseLabelForUnknownTool` 原样回显该工具名，不猜它
 * 是什么、不编一句翻译——同 round 3 `phaseLabelForCallSkillArgs` 回显
 * `skill_stable_name` 的同一条纪律，只是这次回显的是工具名本身。
 */
import type { AgentRunView } from "./agent-run";

type Step = AgentRunView["steps"][number];

const TOOL_PHASE_BY_NAME: Readonly<Record<string, string>> = {
  list_org_skills: "正在准备技能…",
  call_skill: "正在执行技能脚本…",
  ls: "正在查看沙箱文件…",
  glob: "正在搜索文件…",
  grep: "正在搜索文件内容…",
  read_file: "正在读取文件…",
  write_file: "正在写入文件…",
  edit_file: "正在编辑文件…",
};

/** `toolName` 为 `null`（AG-UI 事件里工具名本身缺失）时唯一可用的兜底——见文件头
 *  「真实工具名不在表里时」那节，这与「有名字但表里没收录」不是同一种情况。 */
const DEFAULT_TOOL_PHASE = "正在调用工具…";

/** 表里没收录、但真的有一个观测到的工具名时用这句——原样回显，不编译名。 */
function phaseLabelForUnknownTool(toolName: string): string {
  return `正在调用工具（${toolName}）…`;
}

const PHASE_BY_KIND: Readonly<Record<string, string>> = {
  accepted: "正在准备…",
  context_built: "正在整理上下文…",
  model_called: "模型正在思考…",
  chat_writeback: "正在整理回复…",
};

const FALLBACK_PHASE = "正在处理…";

/**
 * CK-P4（issue #2054）—— 上面这张映射表是**阶段文案的唯一事实源**。CopilotKit v2 轨道
 * 的数据来源不同（AG-UI 事件流，不是 `AgentRunView.steps` 轮询），但用户看到的措辞
 * 必须是同一套：两条轨道各写一份"正在执行技能脚本…"就是本仓 AGENTS.md 点名的
 * 「同一事实声明在两处」，改一处另一处静默漂移。所以 v2 侧
 * （`copilotkit-v2-run-progress.ts`）从这里取词，不复制字符串。
 *
 * `toolName` 为 `null`（AG-UI 事件里工具名缺失）落 `DEFAULT_TOOL_PHASE`；有真实
 * 名字但表里没收录时落 `phaseLabelForUnknownTool`（原样回显该名字）——与
 * `phaseForStep` 逐字同一条纪律。
 */
export function phaseLabelForToolName(toolName: string | null): string {
  if (toolName === null) return DEFAULT_TOOL_PHASE;
  return TOOL_PHASE_BY_NAME[toolName] ?? phaseLabelForUnknownTool(toolName);
}

/**
 * issue #2321 round 3 -- 真实 devapp 场景里一个线程可能同时挂了 pdf-create/
 * docx-create/xlsx-create 好几个技能，"正在执行技能脚本…" 不说是哪一个，用户在
 * 等待期间分不清自己要的 PDF 是不是真的在跑。`call_skill(skill_stable_name, task)`
 * 的第一个参数就是被调用技能的 stable_name（`apps/deep-agent-service/.../tools.py`
 * 的 `call_skill` 签名），这是一段真实从 wire 上收到的字符串，不是编出来的——
 * 原样回显，不额外维护一张"stable_name → 人类可读名"的第二张表（那张表会漂移，
 * 参照文件头「写死映射表」那条纪律：只回显观测到的事实，不猜一个可能过时的译名）。
 *
 * `CALL_SKILL_TOOL_NAME` 与上面 `TOOL_PHASE_BY_NAME.call_skill` 的 key 必须是
 * 同一个字符串——这里用常量而不是重复字面量，避免这张表改名时这条分支悄悄失配。
 */
export const CALL_SKILL_TOOL_NAME = "call_skill";

export function phaseLabelForCallSkillArgs(skillStableName: string): string {
  const trimmed = skillStableName.trim();
  return trimmed === "" ? TOOL_PHASE_BY_NAME[CALL_SKILL_TOOL_NAME] ?? DEFAULT_TOOL_PHASE
    : `正在执行技能脚本（${trimmed}）…`;
}

/** 同上：按 `AgentRunStepKind` 取词，供 v2 轨道映射自己的等价事件。 */
export function phaseLabelForKind(kind: string): string {
  return PHASE_BY_KIND[kind] ?? FALLBACK_PHASE;
}

/**
 * 2026-09-02 —— 桥接层 `CUSTOM {name:"run_phase"}` 推来的「第一个工具调用之前」的
 * 真实阶段（`@repo/contracts/agui-state-events` 的 `AguiRunPhase`），映射到上面同一张
 * 表的措辞，不另写第二份文案：
 *   · `context_building`（执行器已认领、在读技能/历史）→ 与 `context_built` 步骤同一句；
 *   · `model_thinking`（system prompt 就绪、模型调用中）→ 与 `model_called` 步骤同一句。
 */
const KIND_BY_RUN_PHASE: Readonly<Record<string, string>> = {
  context_building: "context_built",
  model_thinking: "model_called",
};

export function phaseLabelForRunPhase(phase: string): string {
  const kind = KIND_BY_RUN_PHASE[phase];
  return kind === undefined ? FALLBACK_PHASE : phaseLabelForKind(kind);
}

/**
 * 取 `steps` 里最新一条，翻译成阶段文案。`steps` 为空（run 刚提交，第一条
 * `accepted` 还没落库）返回 `null`——调用方保留原来纯计时器的「正在思考…」，
 * 不显示一个不存在的阶段。
 */
export function deriveRunPhaseLabel(steps: readonly Step[]): string | null {
  const latest = steps.length === 0 ? null : steps[steps.length - 1];
  if (latest === undefined || latest === null) return null;
  return phaseForStep(latest);
}

function phaseForStep(step: Step): string {
  if (step.kind === "tool_call") {
    if (step.toolName === null) return DEFAULT_TOOL_PHASE;
    return TOOL_PHASE_BY_NAME[step.toolName] ?? phaseLabelForUnknownTool(step.toolName);
  }
  return PHASE_BY_KIND[step.kind] ?? FALLBACK_PHASE;
}
