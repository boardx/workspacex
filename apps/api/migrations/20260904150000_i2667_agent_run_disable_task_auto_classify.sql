-- issue #2667 -- "保留手动『每次都先计划』开关"。
--
-- `TaskClassifierMiddleware`（issue #2662）的全局灰度 `DEEP_AGENT_TASK_AUTO_CLASSIFY`
-- 决定的是整个进程要不要挂这个中间件，粒度是"部署"，不是"这一次消息"。这里加的是更细
-- 一档的 per-run 覆盖：前端"每次都先给我看计划"设置打开时，把这一次 run 标记成
-- "不参与自动判类"，随 run 一起落库，`execute-run.ts` 在真正执行这次 run 时读出、经
-- `deep-agent-model-provider.ts` 的 `configurable` 透传给 `deep-agent-service`。
--
-- NOT NULL DEFAULT false：既有行/未显式覆盖的新行都是"不禁用"，与接入前逐字节行为
-- 相同（这个开关默认关闭，见 `chat-always-plan-first-setting.ts` 头注）。
ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS disable_task_auto_classify boolean NOT NULL DEFAULT false;
