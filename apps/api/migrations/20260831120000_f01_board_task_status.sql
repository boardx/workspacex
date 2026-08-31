-- F01 (board 契约束) -- 任务对象统一五态 enum 与状态机的落地存储 (O-27)。
--
-- 权威规格：phases/phase-02-visible-outcomes/requirements/11-board/uc-11-1-四列看板与推进.md R10
-- 契约单一事实源：packages/contracts/src/board.ts 的 `TaskStatus`（domain 层
-- `apps/api/src/domain/board/task-status.ts` 从那里 derive，这里的 CHECK 约束是
-- 同一份五值在 SQL 侧唯一允许出现的地方——SQL 没法 import 一个 TS 常量，所以两处
-- 必须字面量保持一致；`tests/board/status-enum-single-source.test.ts` 钉住 TS 侧，
-- 这里的 CHECK 是 DB 侧那一半的机械保证）。
--
-- ## tasks -- 任务对象本身
--
--   status       -- 恒为五态之一，CHECK 约束是"没有第六值"从约定变成机械不可能。
--   project_id   -- 可空：F01 notes 允许任务在被排入某个项目之前先存在（inbox 态、
--                    尚未分派项目），这与 O-27 "inbox 只能被离开"的语义并不冲突——
--                    进入 inbox 之外的状态时项目归属由应用层业务规则决定，不是本迁移
--                    要裁决的事。
--   scope        -- 'project' | 'global'。裁定函数（decideTransition）承载的第 4 条
--                    规则（scope=global 下跨项目改列被拒）需要一个信号源来判断"这次
--                    请求是不是来自一个跨项目视图"；这个字段是那个判据在存储层的落点。
--                    真正的全局看板 UI 属于 F02，这里只保证字段存在、约束住取值。
--   executor     -- 可为空（未指派），可以是人类 user_id 也可以是 agent 标识
--                    （例如 "agent:xxx"）——F01 notes 提到"工作卡派发"（F17）会依赖这张
--                    表，这里先留一个不区分人/agent 的自由文本列，具体的 agent 身份解析
--                    留给消费方，不在本迁移里造第二套身份模型。
--
-- FORCE RLS 沿用 0003-identity.sql 的纪律：没有策略的表是一个洞，不是"以后再补"的事。
--
-- 可重放：IF NOT EXISTS / OR REPLACE 全程（migrate:check 忽略版本表强制重放每个文件）。

CREATE TABLE IF NOT EXISTS tasks (
  id             text        PRIMARY KEY,
  org_id         text        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id     text        REFERENCES projects (id) ON DELETE SET NULL,
  title          text        NOT NULL,
  -- 五态单一事实源的 SQL 侧镜像。新增第六个值必须同时改这里和 board.ts 的 TaskStatus，
  -- 两处不一致时 status-enum-single-source 测试与本约束会分别在各自的层面报错。
  status         text        NOT NULL DEFAULT 'inbox'
                 CHECK (status IN ('inbox', 'todo', 'in_progress', 'review', 'done')),
  owner_user_id  text,
  executor       text,
  due_at         timestamptz,
  scope          text        NOT NULL DEFAULT 'project' CHECK (scope IN ('project', 'global')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_org_idx ON tasks (org_id);
CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks (org_id, project_id);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks (org_id, status);

-- updated_at 自动跟手，避免每个调用方各自记一遍"改了要顺手 touch updated_at"。
CREATE OR REPLACE FUNCTION tasks_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_touch_updated_at_trg ON tasks;
CREATE TRIGGER tasks_touch_updated_at_trg
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION tasks_touch_updated_at();

-- ## task_status_audit -- 状态回退的留痕（O-27 规则 2）
--
-- 没有复用 provenance_events（F08，作用域是 artifact/content 的溯源）或
-- tenant_isolation_audit（F02，kernel 自检表）——两者都不是"谁在什么时候把哪张卡从
-- X 改成 Y、理由是什么"的自然归属。这里建一张专属表，append-only（只有 INSERT
-- 路径，没有 UPDATE/DELETE 触发器允许改写），字段与本 feature 要求的审计五元组一一对应：
-- 操作者(actor_user_id)、时间(created_at)、卡片 ID(task_id)、status 前后值
-- (from_status/to_status)、reason。
--
-- 只有"前进跳跃"以外的转移（即需要 reason 的回退）才会写这张表——应用层用例
-- (change-task-status.ts) 负责只在 reason 非空时调用，这里的 CHECK 只保证一旦写入，
-- reason 不能是空/空白字符串滥竽充数。

CREATE TABLE IF NOT EXISTS task_status_audit (
  id             bigserial   PRIMARY KEY,
  org_id         text        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  task_id        text        NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  actor_user_id  text        NOT NULL,
  from_status    text        NOT NULL CHECK (from_status IN ('inbox', 'todo', 'in_progress', 'review', 'done')),
  to_status      text        NOT NULL CHECK (to_status IN ('inbox', 'todo', 'in_progress', 'review', 'done')),
  reason         text        NOT NULL CHECK (btrim(reason) <> ''),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_status_audit_task_idx ON task_status_audit (org_id, task_id, created_at DESC);

-- Append-only: 同一纪律见 0013-f08-provenance-audit.sql / 20260826150000_f972_plan_control_ledger.sql
-- 的 BEFORE UPDATE 触发器——REVOKE UPDATE 只挡得住走 GRANT 的角色，挡不住表属主，触发器
-- 对任何角色一视同仁地拒绝 UPDATE，这才是"没有 UPDATE 路径"从约定变成机械不可能的唯一形状。
CREATE OR REPLACE FUNCTION task_status_audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'TASK_STATUS_AUDIT_APPEND_ONLY: task_status_audit row (id=%) cannot be modified',
    OLD.id
    USING ERRCODE = 'raise_exception',
          DETAIL  = '状态回退审计是留痕，就地改写会让它不再可信。',
          HINT    = '要修正一条错误的审计，写一条新的说明行，不要改旧的。';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS task_status_audit_immutable_trg ON task_status_audit;
CREATE TRIGGER task_status_audit_immutable_trg
  BEFORE UPDATE ON task_status_audit
  FOR EACH ROW EXECUTE FUNCTION task_status_audit_immutable();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'tasks') THEN
    RAISE EXCEPTION 'tasks did not get created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'task_status_audit') THEN
    RAISE EXCEPTION 'task_status_audit did not get created';
  END IF;
END
$$;

-- FORCE RLS，同 0003-identity.sql 的纪律：current_setting(..., true) 未设置时为 NULL，
-- 未限定租户的查询看见的是"什么都没有"（fail-closed），而不是"什么都看得见"。
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tasks', 'task_status_audit']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (org_id = current_setting(''app.current_org'', true)) '
      'WITH CHECK (org_id = current_setting(''app.current_org'', true))',
      t || '_tenant', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_rw', t);
  END LOOP;
END
$$;

GRANT USAGE, SELECT ON SEQUENCE task_status_audit_id_seq TO app_rw;
