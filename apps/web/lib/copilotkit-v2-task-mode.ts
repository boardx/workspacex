/**
 * 任务模式（issue #2130 TW-P0-5②）用户正文前缀——单一事实源 + 幂等拼接。
 *
 * ## issue #2417：这句前缀此前会被拼两遍
 *
 * `copilotkit-v2-panel-body.tsx` 的 `send()` 此前是：
 * ```ts
 * const text = taskMode ? `${TASK_MODE_PREFIX}${rawText}` : rawText;
 * ```
 * 无条件拼接，不检查 `rawText` 是否**已经**以这句前缀开头。用户在测试任务模式时，
 * 如果手动在输入框里也敲了这句触发语（比如在复现/演练这个开关本身该说什么），
 * 加上开关本身的自动拼接，发给模型的正文里这句话会连着出现两遍：
 * ```
 * 请先给出计划，经确认后再执行：请先给出计划，经确认后再执行：<用户原文>
 * ```
 * 这是一个真实、独立的 bug——经排查判断不是 issue #2417 那次生产 100% 失败的直接
 * 原因（真正根因是 deep-agent-service 侧一个只实现了同步 `wrap_model_call` 的
 * middleware 在 `langgraph dev` 异步 runtime 下被框架直接判 `NotImplementedError`，
 * 与这句前缀拼几遍无关，已通过 PR #2423 紧急回滚 + 真实容器日志实锤，见
 * `apps/deep-agent-service/src/deep_agent_service/harness.py` 头注），但拼两遍的
 * 正文本身就是错的，会把用户的真实意图往后挤、让模型看到一句奇怪的重复指令。
 *
 * 修法：`rawText` 已经以这句前缀开头时不再重复拼接一遍——覆盖"用户手动输入前缀 +
 * 开关也拼接"这个真实复现场景（`copilotkit-v2-task-mode.test.ts` 锁死）。
 *
 * ⚠ 这句中文文案曾经与 `deep_agent_service.harness` 的 `TASK_MODE_MARKER` 有一份
 * 跨语言机械一致性看守（PR #2410 引入），但那个常量随 #2410 一起被 PR #2423 回滚——
 * 目前 `graph.py` 的 `SYSTEM_PROMPT` 里这句提示词是独立字面量，没有对应的 Python
 * 侧单一事实源。这不是本次改动引入的状态，是回滚后的现状；若未来 deep-agent-service
 * 侧重新引入需要读这句文案的逻辑，两处都要改，且应该恢复一份机械一致性看守。
 */
export const TASK_MODE_PREFIX = "请先给出计划，经确认后再执行：";

/**
 * 任务模式开启时，把 `TASK_MODE_PREFIX` 拼进 `rawText`——`rawText` 已经以这句前缀
 * 开头时原样返回，不重复拼接。任务模式关闭时逐字节返回 `rawText`，与开关引入前的
 * 既有行为完全相同。
 */
export function applyTaskModePrefix(rawText: string, taskMode: boolean): string {
  if (!taskMode) return rawText;
  if (rawText.startsWith(TASK_MODE_PREFIX)) return rawText;
  return `${TASK_MODE_PREFIX}${rawText}`;
}
