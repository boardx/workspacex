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
 * 见 `apps/api/src/infrastructure/agent-run/deep-agent-model-provider.ts`）。
 * 未识别的 `kind`（未来契约新增值）或未识别的 `toolName` 一律落一句不特指的
 * 「正在处理…」兜底，绝不因为遇到没见过的值就报错或留空——参照同一份文件里
 * `hasMountedSkills` 分支的既有纪律：宁可笼统，不可编造归因。
 */
import type { AgentRunView } from "./agent-run";

type Step = AgentRunView["steps"][number];

const TOOL_PHASE_BY_NAME: Readonly<Record<string, string>> = {
  list_org_skills: "正在准备技能…",
  call_skill: "正在执行技能脚本…",
};

const DEFAULT_TOOL_PHASE = "正在调用工具…";

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
 * `toolName` 为 `null`（AG-UI 事件里工具名缺失）或表里没有的名字，一律落
 * `DEFAULT_TOOL_PHASE`——与 `phaseForStep` 逐字同一条兜底纪律。
 */
export function phaseLabelForToolName(toolName: string | null): string {
  if (toolName === null) return DEFAULT_TOOL_PHASE;
  return TOOL_PHASE_BY_NAME[toolName] ?? DEFAULT_TOOL_PHASE;
}

/** 同上：按 `AgentRunStepKind` 取词，供 v2 轨道映射自己的等价事件。 */
export function phaseLabelForKind(kind: string): string {
  return PHASE_BY_KIND[kind] ?? FALLBACK_PHASE;
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
    return TOOL_PHASE_BY_NAME[step.toolName] ?? DEFAULT_TOOL_PHASE;
  }
  return PHASE_BY_KIND[step.kind] ?? FALLBACK_PHASE;
}
