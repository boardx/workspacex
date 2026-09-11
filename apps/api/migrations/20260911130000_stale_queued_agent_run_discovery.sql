-- issue #3439 —— `queued` 缺一个跨租户的"没人会再来敲它"发现机制。
--
-- `agent_run_executor.ts` 头注写得很直白："Why acceptance kicks it, instead of a timer
-- scanning for work"：`queued` 依赖同租户"下一条消息"的 kick 找回它自己。这在
-- issue #3420 之前一直成立，因为**每一条**把 run 送回 `queued` 的路径后面都跟着一次
-- 显式 `kick(orgId)`（接收新消息、`decideToolPermission` 里人裁决完）。
--
-- #3420 新增的 `requeueAuthorizedToolCall`（`running → queued`，已授权工具自动续跑）
-- 是**唯一**一条例外：它发生在 `AgentRunExecutor.tick()` 自己的执行栈内部
-- （`executeQueuedRuns` 早已经调过一次 `claimQueued`，这次新写的 `queued` 行赶不上那一批），
-- 调用点又没有像 `decideToolPermission` 那样补一次 `kick`——这条 run 因此彻底没有下一次
-- 会被 `claimQueued` 认领的理由，除非**碰巧**同一个组织的另一条线程送来一条新消息。
-- 单用户/单线程会话下这个"碰巧"永远不会发生：run 永久卡在 `queued`（人类实测 run
-- 49fd3220，租约过期 12+ 分钟、`recovery_attempts=0`，见 issue 原文）。
--
-- `sweep-orphaned-runs.ts` 已经是这个系统里唯一"没有租户在敲、也要保证最终有人来收"的
-- 跨租户兜底（`withoutTenant` + 每分钟一次 + API 启动时一次）——`running` 的等价缺口
-- （进程重启造成的孤儿）就是靠它补的。这里让它认出同一形状的 `queued` 缺口：不改
-- `PgRunRecovery`（它只该管 `running` 的远端核对，`queued` 不需要问远端，本地
-- `claimQueued` 本来就正确，只是没人调），不改 `claimQueued`（它的 WHERE 从来没错，
-- 缺的是触发），只在"该敲哪些组织的门"这一层加一条判据，与 `running` 那条判据
-- 逐字同一个阈值、同一个"心跳/开始时间 + 阈值"公式，不另立一套"多久算卡住"。
--
-- 只读发现，不做任何 UPDATE——真正认领仍然是 `claimQueued` 自己的
-- `FOR UPDATE SKIP LOCKED`，这里只负责让它被调用到。天然排除刚创建、还没被
-- claim 过一次的健康 `queued` 行：那类行 `started_at`/`heartbeat_at`/`lease_expires_at`
-- 全是 NULL，`coalesce(...)  < now()` 结果是 NULL（假），不会被当成"该敲门"。
CREATE OR REPLACE FUNCTION kernel_stale_queued_agent_run_orgs(threshold_ms integer)
RETURNS TABLE(org_id text)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT DISTINCT r.org_id FROM agent_runs r
  WHERE r.status='queued' AND coalesce(r.lease_expires_at,
    coalesce(r.heartbeat_at,r.started_at)+(threshold_ms||' milliseconds')::interval)<now()
  LIMIT 100
$$;
