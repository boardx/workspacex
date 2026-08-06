-- #619 A: `org_agents` 收敛进 `capability_listings`（F15，已落地的那套）。
--
-- ## 为什么（迁移文件 0032 的原话，实测复核过）
--
-- `0032-f110-ai-team-panel.sql` 的文件头逐字写着：`org_agents` 只是「本束在它落地前的
-- 一个占位目录」，等的是「04-agent: agent 清单/可见性范围来自组织配置（phase-00 F15）」。
-- `phase-00 F15` 就是 `capability_listings`（见 `0008-f15-capability-listings.sql`）——
-- 它早就落地了，只是从没有人把 `org_agents` 接上去。本迁移做的就是这一步「接上去」，
-- **不是发明新设计**。
--
-- ## 为什么不是物理收敛（不删 `org_agents` 表）
--
-- `org_agents` 表本身不动——只切断 `chat_thread_agents` 对它的**依赖**（外键 + 读查询）。
-- 表变成无用但无害的遗留：种子脚本仍然可以写它，不会报错，只是没有任何代码再读它。
-- ⚠ 完全物理删除是后续清理，本迁移不做，理由是**收窄改动面**——`org_agents` 的
-- DROP TABLE 会牵连它自己的 RLS 策略与 GRANT，属于与"收敛roster判断依据"不同的另一个动作。
--
-- ## 为什么用触发器而不是外键
--
-- 目标约束是「`agent_id` 必须指向本组织一条 `kind='agent' AND enabled=true` 的
-- `capability_listings` 行」——**普通外键表达不了 `kind`/`enabled` 这两个条件**，
-- 只能约束"这一行存在"。触发器是本仓已有的解法（`wave2_skill_mount_target_same_org`
-- 同一形状：多态引用 + 额外条件，见 `20260804031000_wave2_skill_starter_import.sql`）。
--
-- 可重放：DO 块动态查找旧外键名（当初没有显式命名），`DROP TRIGGER IF EXISTS` +
-- `CREATE OR REPLACE FUNCTION`。`migrate:check` 会强制重放每个文件。

/* ═══════════════ 一、capability_listings 补 abbr/duty（仅 kind='agent' 用）═══════════════ */

ALTER TABLE capability_listings ADD COLUMN IF NOT EXISTS abbr text;
ALTER TABLE capability_listings ADD COLUMN IF NOT EXISTS duty text;

-- 与既有的 `capability_listings_team_only_needs_team` 同一条规则同一个理由：
-- 「kind=agent 却没有 abbr/duty」不是更宽松的规则，是**无法回答**的规则——
-- AI 团队面板的 I-17（domain.md）要求"每个 agent 必须有非空 duty"，写在这里的 CHECK
-- 是那条不变量在**写入时**的第一道防线（应用层 `mutate-capability.ts` 的字段级 400
-- 是给人看的那道；这里才是真正挡住所有写入者的那道，同 `ownerTeamId` 那条注释的分工）。
ALTER TABLE capability_listings DROP CONSTRAINT IF EXISTS capability_listings_agent_needs_abbr_duty;
ALTER TABLE capability_listings
  ADD CONSTRAINT capability_listings_agent_needs_abbr_duty
  CHECK (kind <> 'agent' OR (
    abbr IS NOT NULL AND length(trim(abbr)) > 0 AND
    duty IS NOT NULL AND length(trim(duty)) > 0
  ));

/* ═══════════ 二、chat_thread_agents 的合法性判据改指 capability_listings ═══════════ */

-- 找到 chat_thread_agents → org_agents 那条外键（当初没有显式命名，交给
-- Postgres 自动生成，因此这里动态查找而不是硬编码猜测的名字）并丢弃。
DO $$
DECLARE
  fk_name text;
BEGIN
  SELECT conname INTO fk_name
    FROM pg_constraint
   WHERE conrelid = 'chat_thread_agents'::regclass
     AND confrelid = 'org_agents'::regclass
     AND contype = 'f';
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE chat_thread_agents DROP CONSTRAINT %I', fk_name);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION i619_chat_thread_agent_is_enabled_capability() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM capability_listings
     WHERE id = NEW.agent_id
       AND org_id = NEW.org_id
       AND kind = 'agent'
       AND enabled = true
  ) THEN
    RAISE EXCEPTION 'Roster agent is not an enabled agent capability listing in this organization';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chat_thread_agent_is_enabled_capability_trg ON chat_thread_agents;
CREATE TRIGGER chat_thread_agent_is_enabled_capability_trg
  BEFORE INSERT OR UPDATE ON chat_thread_agents
  FOR EACH ROW EXECUTE FUNCTION i619_chat_thread_agent_is_enabled_capability();

COMMENT ON TABLE org_agents IS
  '⚠ #619 起，`chat_thread_agents` 不再依赖这张表——收敛进了 `capability_listings`
   （见 20260807000000_i619_agent_roster_capability_convergence.sql）。这张表本身未删，
   仅为收窄本次改动面；不要再往这张表写新数据，也不要在新代码里读它。';
