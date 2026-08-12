/*
 * F162 —— 限额策略：规则表 + 触发事件表。
 *
 * ## 两张表的分工，以及为什么事件表不跟着规则删
 *
 * `limit_rules` 是**可变配置**（阈值会调、规则会停用会删）。
 * `limit_events` 是**账**：某年某月某日，某条规则在某人身上触发了、当时观测到多少。
 * 所以事件表对规则是 `ON DELETE SET NULL` 而不是 CASCADE——删掉一条规则不该让
 * 「上个月他被降级过三次」这件事从历史里消失。同一条纪律，`token_usage_events`
 * 对 `agent_runs` 也是这么处理的。
 *
 * ⚠ 因此 `limit_events` 冗余存了 `scope_kind` / `threshold_tokens`：规则可能已经不在，
 *   或者阈值早就被改过。事件必须自带「当时那条规则长什么样」的快照，
 *   否则读历史时会用今天的阈值去解释昨天的触发——一份看起来自洽、实则错位的报表。
 *   这**不是**「同一事实两处声明」：规则表存的是「现在的规则」，事件表存的是
 *   「当时的规则」，两者本来就会不同，且必须不同。
 *
 * ## `scope_kind` 五值：一份事实，三种语言
 *
 * 契约 `orgAdmin.LimitScopeKind`（唯一事实源）↔ 本文件的 CHECK ↔ 前端的中文标签。
 * `limit-rule-crud.test.ts` 从 `pg_constraint` 把 CHECK 里的取值读回来，与契约枚举
 * 断言集合相等——枚举漂移是会红的东西，不是靠人记得同步。
 *
 * Replayable：IF NOT EXISTS / OR REPLACE，重放安全。
 */

CREATE TABLE IF NOT EXISTS limit_rules (
  id               text PRIMARY KEY,
  org_id           text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  scope_kind       text NOT NULL CHECK (scope_kind IN ('member', 'role', 'team', 'agent', 'model')),
  scope_ref        text NOT NULL,
  -- NULL = 全部模型。不用 '*' 之类的魔法字符串：那个字符串迟早会有人当成真的模型 id。
  model_id         text NULL,
  window_kind      text NOT NULL CHECK (window_kind IN ('hour', 'day', 'week', 'month')),
  threshold_tokens bigint NOT NULL CHECK (threshold_tokens > 0),
  action           text NOT NULL CHECK (action IN ('warn', 'degrade', 'block', 'require_approval')),
  -- 降级目标。⚠ 数据库这一层就钉住「降级必须说降到哪」：`degrade` 而不说目标
  -- 等于运行时静默换模型，正是 I-28「绝不静默换模型」的反面。
  degrade_to_model_id text NULL,
  enabled          boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT limit_rules_degrade_target_check CHECK (
    (action = 'degrade' AND degrade_to_model_id IS NOT NULL)
    OR (action <> 'degrade' AND degrade_to_model_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS limit_rules_org_idx ON limit_rules (org_id, enabled, scope_kind);

CREATE TABLE IF NOT EXISTS limit_events (
  id               text PRIMARY KEY,
  org_id           text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- 规则被删了事件也留着（见文件头）。
  rule_id          text NULL REFERENCES limit_rules (id) ON DELETE SET NULL,
  -- 当时那条规则的快照：规则可能已不在、阈值可能已被改。
  scope_kind       text NOT NULL CHECK (scope_kind IN ('member', 'role', 'team', 'agent', 'model')),
  subject_ref      text NOT NULL,
  action_taken     text NOT NULL CHECK (action_taken IN ('warn', 'degrade', 'block', 'require_approval')),
  observed_tokens  bigint NOT NULL CHECK (observed_tokens >= 0),
  threshold_tokens bigint NOT NULL CHECK (threshold_tokens > 0),
  occurred_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS limit_events_org_time_idx ON limit_events (org_id, occurred_at DESC);

/* 事件是账，append-only，同 `token_usage_events`。规则表不是账，可改可删。 */
CREATE OR REPLACE FUNCTION f162_limit_event_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN
    RETURN OLD;
  END IF;
  -- ⚠ 规则删除触发的 `ON DELETE SET NULL` 是 UPDATE，必须放行：那是外键的级联动作，
  --   不是调用方在改账。放行范围严格限定为「只有 rule_id 从非空变成空」这一种变化。
  IF TG_OP = 'UPDATE'
     AND NEW.rule_id IS NULL AND OLD.rule_id IS NOT NULL
     AND NEW.id = OLD.id AND NEW.org_id = OLD.org_id
     AND NEW.scope_kind = OLD.scope_kind AND NEW.subject_ref = OLD.subject_ref
     AND NEW.action_taken = OLD.action_taken
     AND NEW.observed_tokens = OLD.observed_tokens
     AND NEW.threshold_tokens = OLD.threshold_tokens
     AND NEW.occurred_at = OLD.occurred_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'limit events are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS limit_events_append_only_trg ON limit_events;
CREATE TRIGGER limit_events_append_only_trg
  BEFORE UPDATE OR DELETE ON limit_events
  FOR EACH ROW EXECUTE FUNCTION f162_limit_event_append_only();

ALTER TABLE limit_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE limit_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS limit_rules_tenant ON limit_rules;
CREATE POLICY limit_rules_tenant ON limit_rules
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

ALTER TABLE limit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE limit_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS limit_events_tenant ON limit_events;
CREATE POLICY limit_events_tenant ON limit_events
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON limit_rules TO app_rw;
REVOKE ALL ON limit_events FROM app_rw;
GRANT SELECT, INSERT ON limit_events TO app_rw;

SELECT kernel_apply_org_freeze_policies();
