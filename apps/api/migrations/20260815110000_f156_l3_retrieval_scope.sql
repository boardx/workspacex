-- F156（design-delta `personal-thread-own-attachment-recall`，人类 2026-08-12 口径确认，
-- confirmed_at 2026-08-12）：给 F157 的 `agent_run_context_snapshots` 补一个**最小映射列**，
-- 让快照能区分「这次 L3 查询走的是哪条范围分支」——`own-attachment`（个人线程只吃本线程自己
-- 的附件）还是 `project-retrieval`（项目线程走既有项目范围）。
--
-- ## 为什么必须补，不是可选的可观测性糖
--
-- delta §2 点 2 原话：「`agent_run_context`（F157 快照）需能分辨这两者……否则 F156 反证退化成
-- 『数一个不再为 0 的总数』，测不出泄漏」。F157 落地时的 `l3_sources` 记的是**命中的内容类型**
-- （`chat-attachment`/`canvas-artifact`，见 `file-retrieval.ts` 的 `FileRetrievalSourceKind`），
-- 这是一个与「查询走了哪条范围分支」正交的维度——一次 `own-attachment` 范围的查询命中的一样
-- 是 `chat-attachment` 这个 kind。两个概念不能共用一个字段，所以加而不是复用。
--
-- ## 为什么是一个值，不是命中级别的数组
--
-- 范围分支在一次 L3 查询里只有一个（`pg-file-retrieval.ts` 的 `FileRetrievalScope.projectId`
-- 要么 null 要么非 null，两条分支互斥），不是逐条命中各自归属不同分支——所以是**一次 run 一个
-- 标量**，与 `l3_status`/`l3_hit_count` 同级，不是 `l3_sources` 那种去重集合。
--
-- `NULL` = 这次 run 根本没有发起 L3 查询（`l3_status IN ('not_configured')`，或该 run 早于
-- 本迁移、没有这一列的历史数据）。

ALTER TABLE agent_run_context_snapshots
  ADD COLUMN IF NOT EXISTS l3_retrieval_scope text
    CHECK (l3_retrieval_scope IS NULL OR l3_retrieval_scope IN ('own-attachment', 'project-retrieval'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'agent_run_context_snapshots' AND column_name = 'l3_retrieval_scope'
  ) THEN
    RAISE EXCEPTION 'agent_run_context_snapshots.l3_retrieval_scope did not get created';
  END IF;
END
$$;
