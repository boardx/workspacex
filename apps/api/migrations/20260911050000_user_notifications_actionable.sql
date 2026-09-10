-- issue #3311：通知分两类，点击语义不同，所以类别必须是**存下来的事实**而不是前端猜标题。
--   actionable=false（收据）：「已完成 / 执行失败」——事情已经发生，点开看结果，看了就读掉。
--   actionable=true（待办）：「等待你授权工具 / 等待你确认计划」——事情**还没办**，
--     点开只是把用户送到能办的地方，不许因为看了一眼就被消费掉。
-- 存量行一律按收据处理（默认 false）：它们是历史收据，重放不出待办语义。
ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS actionable boolean NOT NULL DEFAULT false;
