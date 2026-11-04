import type { AgentRunError, AgentRunFailureReason } from "./agent-run";

export const AGENT_RUN_ERROR_TEXT: Record<AgentRunError, string> = {
  CREDIT_REQUIRED: "可用额度不足，请确认计费账户并充值后继续",
  CREDIT_ACCOUNTING_UNAVAILABLE: "计费服务暂时不可用，请稍后重试或联系管理员",
  HITL_REJECTED: "已被人工拒绝执行",
  MODEL_PROVIDER_NOT_CONFIGURED: "所选模型服务尚未配置，请联系管理员",
  SKILL_VERSION_UNAVAILABLE: "所需的 skill 版本当前不可用",
  AGENT_VERSION_UNAVAILABLE: "所选 Agent 版本已不可用，请重新选择 Agent 后再试",
  MODEL_CALL_FAILED: "模型这次没能返回可用结果",
  CHAT_WRITEBACK_FAILED: "回复已生成，但写入对话失败",
  TOOL_LOOP_LIMIT_EXCEEDED: "工具调用次数超出上限，模型未能给出最终答案",
  // Phase 14 F01（kernel-gateway 契约束 R4 A1）：网关下发前健康检查未过，请求根本
  // 没有发出去——与 MODEL_CALL_FAILED（调用已发起、内核/模型出错）是不同的事实。
  KERNEL_UNAVAILABLE: "服务暂时不可用，请稍后重试",
  // issue #2860：执行它的服务进程重启了，run 被回收器收敛成终态——不是模型出错，重发即可。
  RUN_INTERRUPTED: "上一条任务因服务重启被中断了，请重新发送",
};

export const AGENT_RUN_FAILURE_REASON_TEXT: Record<AgentRunFailureReason, string> = {
  provider_returned_empty: "模型这一轮既没有给出文本，也没有给出下一步动作",
  provider_rejected: "执行任务的智能体服务自己报错退出了",
  provider_timeout: "执行任务的智能体服务在预算时间内没有跑完",
  provider_transport_failed: "与执行任务的智能体服务之间的连接失败了",
  runtime_unavailable: "这次执行依赖的服务未配置或不可用，调用没能发出去",
  tool_call_unresolved: "有一次工具调用始终没有返回结果（不是模型没出话）——多半是它执行的脚本卡住或失败了",
  executor_defect: "这是我们服务端的缺陷，不是模型的问题，请把这次的任务编号报给管理员",
  run_reaped: "执行它的服务进程中途没了，这条任务被系统收尾了",
  unknown: "未能识别出具体原因，请把这次的任务编号报给管理员",
};
