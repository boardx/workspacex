-- 0032 F110: AI 团队面板 —— 在场三态 + 编制（roster）
-- (phase-01 contracts/chat/domain.md I-17 / I-18，uc-8-2 UC-7)
--
-- ## 这个文件在防什么
--
--   · I-18「presentCount 与 rosterCount 分离，两者不得互相顶替」—— 所以这里没有一张
--     「计数缓存表」，两个数都是对同一张明细表的两次不同 COUNT（见仓储实现）：
--     `rosterCount = count(*)`，`presentCount = count(*) WHERE presence = 'present'`。
--     算出缓存列的实现会在第一次并发写之后与明细分家（同 0029 头部 I-13 的教训）。
--
--   · I-17「presence 三值封闭 + 每个 agent 必须有非空 duty」—— presence 用 CHECK
--     锁死取值集合（与契约 `chat.AgentPresence` 同码：`present`/`away`/`off`），
--     duty 的非空性由应用层断言（`domain/chat/agent-presence.ts`），这里不重复一遍
--     字符串长度 CHECK：CHECK 管的是「这一列的取值域」，不是「这个业务规则」，
--     duty 是不是空是产品规则，不是数据完整性（同 0021 头部对 TITLE_INVALID 的态度）。
--
--   · `AGENT_OUT_OF_SCOPE`（契约 `updateAgentRoster` 的错误码）—— 编制新增的 agent
--     必须先存在于**组织的 agent 目录**（`org_agents`）。目录本身**不是**本 feature
--     的权威来源：F110 notes 里逐字写着「04-agent: agent 清单/可见性范围来自组织配置
--     （phase-00 F15），原型里 6 个 agent 只是示例」——这条跨分片依赖尚未落地，
--     `org_agents` 只是本束在它落地前的一个占位目录，供 `updateAgentRoster` 判断
--     「越范围」用，不冒充那个尚不存在的组织级 agent 配置平面。
--
-- ## 这个文件刻意**没有**做的事
--
--   · 没有建任何「agent 全局在场心跳」表——presence 是**线程内该 agent 的编制行上的
--     一列**，不是跨线程的全局状态。跨线程的「同一个 agent 在别的线程里是不是也在场」
--     不在 uc-8-2 UC-7 的验收范围内，属于待裁决（domain.md 待裁决第 4 条）。
--
-- 可重放：全部 IF NOT EXISTS，`migrate:check` 会强制重放每个文件。

/* ═══════════════ 一、组织 agent 目录（编制范围校验用，见文件头）═══════════════ */

CREATE TABLE IF NOT EXISTS org_agents (
  org_id   text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  abbr     text NOT NULL,
  name     text NOT NULL,
  duty     text NOT NULL,
  PRIMARY KEY (org_id, agent_id)
);

COMMENT ON TABLE org_agents IS
  '组织的 agent 目录（占位）。`updateAgentRoster` 的 AGENT_OUT_OF_SCOPE 判定读它；'
  '不是 04-agent/F15 的权威落地——那条跨分片依赖尚未确认，见 0032 文件头。';

/* ═══════════════ 二、线程的 agent 编制（roster）═══════════════ */

CREATE TABLE IF NOT EXISTS chat_thread_agents (
  thread_id  text NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  agent_id   text NOT NULL,
  -- 三值封闭，同码同义于契约 `chat.AgentPresence`（present/away/off）。
  presence   text NOT NULL DEFAULT 'off'
             CHECK (presence IN ('present', 'away', 'off')),
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, agent_id),
  FOREIGN KEY (org_id, agent_id) REFERENCES org_agents (org_id, agent_id)
);

CREATE INDEX IF NOT EXISTS chat_thread_agents_org_idx
  ON chat_thread_agents (org_id, thread_id);

COMMENT ON COLUMN chat_thread_agents.presence IS
  'I-17/I-18 的事实来源。presentCount = count(*) WHERE presence=''present''；'
  'rosterCount = count(*)。两个数分别对同一张表两次 COUNT，不是两处各算一次。';

-- 编制版本：乐观并发，同 `chat_threads.version` 的做法（0029/0021），
-- 单独一列而不是复用 `chat_threads.version`——编制变更与改名/删除是两条独立的写路径，
-- 共用一个版本号会让「改名把编制的乐观锁撞飞」这种无关操作互相绊倒。
ALTER TABLE chat_threads
  ADD COLUMN IF NOT EXISTS roster_version integer NOT NULL DEFAULT 0;

/* ═══════════════ 三、RLS：与其余租户表同一条规则 ═══════════════ */

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['org_agents', 'chat_thread_agents']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (org_id = current_setting(''app.current_org'', true)) '
      'WITH CHECK (org_id = current_setting(''app.current_org'', true))',
      t || '_tenant', t);
  END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON org_agents TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON chat_thread_agents TO app_rw;

-- 新建的租户表必须自己补这一次调用（0021/0029 头部同一个坑）。
SELECT kernel_apply_org_freeze_policies();
