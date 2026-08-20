-- #1624 —— chat 里挂了 skill 之后，模型写的脚本在沙箱里跑出来的文件，要跟着这一条 run
-- 走到写回事务，挂成助手消息的附件。
--
-- ## 为什么必须存在 run 上，而不是执行完就直接插附件行
--
-- 助手消息在 `commitWriteback` 那一刻才存在（`agent_runs` 状态机：running →
-- writeback_pending → succeeded）。执行发生在 `writeback_pending` 之前，那时还没有
-- `message_id` 可挂。字节已经落进对象存储（`ObjectStore.putOnce`，与试跑同一条），
-- 这一列存的只是**引用清单**，不是字节。
--
-- ⚠ 不能改用「先落 message_id IS NULL 的 pending 附件行」：那是**用户上传**的语义
--   （#946），下一条用户消息会把该线程的 pending 附件挂到自己身上——agent 产出的文件
--   会被挂到用户的下一句话上，且占掉「每线程 ≤10 pending」的名额。
--
-- ## DEFAULT '[]' 是不回归的保证
--
-- 没有沙箱端口注入的部署里这一列恒为 `[]`，`commitWriteback` 不会插任何附件行，
-- 行为与本次改动之前逐字节相同。
ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS model_output_files jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 组织冻结策略（合规冻结时禁写），与其余租户表一致。
SELECT kernel_apply_org_freeze_policies();
