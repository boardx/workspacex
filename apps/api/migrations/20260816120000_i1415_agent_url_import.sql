-- #1415 —— agent 版的 `skill_url_imports`（20260806040000_i595_skill_url_import.sql）。
-- 同一条设计：这张表只做**幂等键去重**，不是 agent 的内容存储——agent 的"内容"
-- 已经落在 `agents.instructions`（`setAgentInstructions` 写入），这里只记
-- "这个幂等键对应哪个 agent"，好让重放请求能找回同一个结果而不重复建号。

CREATE TABLE IF NOT EXISTS agent_url_imports (
  id              text PRIMARY KEY,
  org_id          text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  -- 取回**完成后**的最终 URL（重定向可能换了地址）；审计要的是真正读了哪里。
  source_url      text NOT NULL,
  content_digest  text NOT NULL CHECK (content_digest ~ '^[a-f0-9]{64}$'),
  agent_id        text NOT NULL,
  actor_id        text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_url_imports_idem_uniq UNIQUE (org_id, idempotency_key),
  CONSTRAINT agent_url_imports_agent_fk FOREIGN KEY (agent_id, org_id)
    REFERENCES agents (id, org_id) ON DELETE CASCADE
);

ALTER TABLE agent_url_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_url_imports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_url_imports_tenant ON agent_url_imports;
CREATE POLICY agent_url_imports_tenant ON agent_url_imports
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON agent_url_imports FROM app_rw;
GRANT SELECT, INSERT ON agent_url_imports TO app_rw;

-- 与 skill_url_imports 那张迁移同理：冻结策略只看得见运行时已存在的表，加完新租户表要重放一次。
SELECT kernel_apply_org_freeze_policies();
