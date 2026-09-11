-- issue #3403 ④ —— 失败成因里缺一个词：「工具调用没有回来」。
--
-- 人类 2026-09-11 实测：PPT 生成跑了 17:29，第 5 次 `execute`（技能自带的
-- `render-office.py`）始终没有交回结果，而产品面上那句话是「模型这次没能返回可用
-- 结果」。**真正没有回来的是一次工具调用，不是模型**——把脚本/工具的失败说成模型
-- 的失败，会把排查引向完全错误的方向（正是 #3280 / #3323 那条要防的事）。
--
-- 既有六条分类规则全部按 `ModelCallError.detail` 的**措辞**匹配，而这一幕的 detail
-- 是远端 run 的超时/报错原话，于是落进 `provider_timeout`——说的是「智能体服务没跑
-- 完」，仍然指向模型侧。新增的这个值不靠措辞猜：它由**结构事实**判定——这轮终止时
-- 账本里还有已开、未闭的工具调用（见 `execute-run.ts` 的 `openToolCalls`）。
ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_failure_reason_check;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_failure_reason_check CHECK (
  failure_reason IS NULL OR failure_reason IN (
    'provider_returned_empty',
    'provider_rejected',
    'provider_timeout',
    'provider_transport_failed',
    'run_reaped',
    'runtime_unavailable',
    'executor_defect',
    'tool_call_unresolved',
    'unknown'
  )
);
