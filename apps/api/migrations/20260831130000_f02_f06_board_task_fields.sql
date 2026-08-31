-- F02/F06（board 契约束）—— 在 F01 的 tasks 表上补齐看板投影/卡片渲染/回写/
-- 「我的今天」分区需要、但 F01 尚未建的字段。
--
-- 权威规格：
--   phases/phase-02-visible-outcomes/requirements/11-board/uc-11-1-四列看板与推进.md R3/R7
--   phases/phase-02-visible-outcomes/requirements/11-board/uc-11-5-我的今天.md R3/R7
-- 契约单一事实源：packages/contracts/src/board.ts 新增的 SourceKind / RiskLevel。
--
-- ## 这次范围收窄了什么（如实记录，见 feature_list.json F02/F06 的 notes/evidence）
--
-- F06 依赖表里点名的 F03（六来源自动汇入）/F05（到期提醒）/F08（授权流）本次都
-- 不做。这意味着：
--   · `source_kind` 本次只会被写入 '手工创建'——CHECK 约束仍然
--     放开全部七个取值（见 board.ts 头注），给 F03 的六个自动适配器留口子，
--     但没有任何代码路径在本次改动里写别的值。
--   · 没有新增"授权等待"“R2/R3 审批点"之类的表/列——那是 F07/F08 的范围，
--     「我的今下判断分区」里对应这两类的判定这次直接跳过（domain 层
--     `my-today-sections.ts` 的头注写清楚了）。
--
-- ## 新增列
--
--   source_kind   -- 七类来源徽标之一（见上），NOT NULL，默认 '手工创建'。F01 建表时
--                     还没有这个概念，旧行（如果有）一律回填默认值——不存在"没有来源"
--                     的任务卡。
--   risk_level    -- R1/R2/R3，可空（F02/F06 只搬运展示，不做 O-26 推导，见契约头注）。
--   waiting_on    -- 「④ 下一步轮到别人」区消费的字段（uc-11-5 R7「必须显示在等谁」）。
--                     本次实现为一个自由文本列（人名/说明），不是外键、不是复杂对象——
--                     user_email 的任务指令原话「可以是文本或指向某个人的引用，不必做成
--                     复杂对象」。可空：未交棒的卡没有 waiting_on。
--   sync_status   -- 「回写事务」契约需要的落点（uc-11-1 R3.3/R7「回写失败必须显式标记，
--                     不得静默丢弃」）。'synced' | 'out_of_sync'，默认 'synced'。手工创建的
--                     卡没有真实的外部来源对象要回写，`WritebackPort` 的 no-op 实现恒定
--                     返回成功，这一列因此在本次范围内恒为 'synced'——但列存在、约束存在，
--                     retry 接口与失败路径可以真的把它翻成 'out_of_sync'（见
--                     writeback-transaction.test.ts 用一个"会失败"的假 WritebackPort
--                     断言这条路径，不是只测 no-op 那条必然成功的路径）。
--
-- 可重放：与 F01 同一纪律，ADD COLUMN IF NOT EXISTS 全程。

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT '手工创建',
  ADD COLUMN IF NOT EXISTS risk_level  text,
  ADD COLUMN IF NOT EXISTS waiting_on  text,
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'synced';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_source_kind_check'
  ) THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_source_kind_check
      CHECK (source_kind IN ('手工创建', '现场', '会前任务', '决策树', '报告缺料', '转写', '研究'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_risk_level_check'
  ) THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_risk_level_check
      CHECK (risk_level IS NULL OR risk_level IN ('R1', 'R2', 'R3'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_sync_status_check'
  ) THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_sync_status_check
      CHECK (sync_status IN ('synced', 'out_of_sync'));
  END IF;
END
$$;

-- `owner_user_id` 恒为人（D-39，AC4）：F01 迁移把它建成了一个自由文本、可空列
-- （agent 身份解析留给消费方）。F02 在应用层（`create-task.ts`/`assert-human-owner.ts`）
-- 拒绝把 agent 标识写进这一列——这里补一条 CHECK 作为 DB 侧最后一道机械防线，
-- 只挡"看起来就是 agent 标识"的字面量前缀（`agent:`），不做身份表联查（那需要一次
-- 跨表查询，CHECK 约束做不到，交给应用层 `assertHumanOwner`）。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_owner_not_agent_literal_check'
  ) THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_owner_not_agent_literal_check
      CHECK (owner_user_id IS NULL OR owner_user_id NOT LIKE 'agent:%');
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS tasks_owner_idx ON tasks (org_id, owner_user_id);
CREATE INDEX IF NOT EXISTS tasks_due_at_idx ON tasks (org_id, due_at);
