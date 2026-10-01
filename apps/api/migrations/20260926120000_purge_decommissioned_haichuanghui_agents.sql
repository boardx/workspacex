-- 「海创汇」四个 team（team1 上会审阅 / team2 投后财务评级 / team3 前沿赛道技术路线研判 /
-- team4 投后管理报告）代码已全部下线（#4184、#3858、#4012），但当初种进库里的 agent /
-- skill 行一直没删干净——这正是 deploy.sh 4d3 步 `purge-postinvest-agents.ts --apply`
-- 每次都失败的原因（2026-09-26 #4237）：它想删的 `agent_runs` 一旦级联，就会碰到
-- `agent_run_steps` / `agent_run_deltas` / `agent_run_attempts` / `agent_artifacts` /
-- `agent_artifact_versions` 的 append-only 触发器，以及 `agent_versions` /
-- `skill_versions` / `skill_version_files` 的 immutable 触发器——整个事务回滚、一行没删。
--
-- 这些触发器挡的是「调用方悄悄改写历史记录」，不是「这四个 ad-hoc Agent 该不该整体清除」；
-- 后者是已经做过的人类决定（#4012「开源仓库里不留私有 agent 技术的任何内容」）。跟本仓
-- 已有的先例（`20260905120000_f06_tool_permission_tiering.sql` 用
-- `ALTER TABLE ... DISABLE/ENABLE TRIGGER` 临时放行一次性数据修复）同一个做法：
-- 只在这条一次性迁移的事务里、只对命中的这几行，临时关掉挡着的触发器。
--
-- 用户对话内容不动：只摘 `agent_id`/`run_id` 关联行与挂载行，`chat_threads`/`chat_messages`
-- 本身不碰（同 `purge-postinvest-agents.ts` 默认不带 `--purge-threads` 的理由）。
--
-- 幂等：命中 0 行时每一步 `DELETE ... WHERE id = ANY('{}')` 都是合法空操作。
DO $$
DECLARE
  agent_names text[] := ARRAY[
    '上会材料智能审阅助手',   -- team1
    '投后财务项目评级 Agent', -- team2
    '前沿赛道技术路线研判',   -- team3
    '投后管理报告 AI 生成单元' -- team4
  ];
  skill_ids text[] := ARRAY[
    'skill-team1-ic-review-standard',
    'skill-team4-post-investment-report'
  ];
  skill_stable_names text[] := ARRAY['ic-review-standard', 'post-investment-report'];
  target_agent_ids text[];
  target_run_ids text[];
  target_skill_ids text[];
  target_skill_version_ids text[];
  tbl text;
BEGIN
  SELECT coalesce(array_agg(id), ARRAY[]::text[]) INTO target_agent_ids
    FROM agents WHERE name = ANY(agent_names);
  SELECT coalesce(array_agg(id), ARRAY[]::text[]) INTO target_skill_ids
    FROM skills WHERE id = ANY(skill_ids) OR stable_name = ANY(skill_stable_names);

  RAISE NOTICE '[purge-haichuanghui] 命中 agents: %, skills: %', target_agent_ids, target_skill_ids;

  IF array_length(target_agent_ids, 1) > 0 THEN
    SELECT coalesce(array_agg(id), ARRAY[]::text[]) INTO target_run_ids
      FROM agent_runs WHERE agent_id = ANY(target_agent_ids);
  ELSE
    target_run_ids := ARRAY[]::text[];
  END IF;

  IF array_length(target_skill_ids, 1) > 0 THEN
    SELECT coalesce(array_agg(id), ARRAY[]::text[]) INTO target_skill_version_ids
      FROM skill_versions WHERE skill_id = ANY(target_skill_ids);
  ELSE
    target_skill_version_ids := ARRAY[]::text[];
  END IF;

  -- ① agent_runs 的下游表：按 run_id 定位，逐表关触发器再删——这是本迁移要解决的根因
  --   （cascade 会照样触发这些表各自的 append-only BEFORE DELETE 触发器）。
  IF array_length(target_run_ids, 1) > 0 THEN
    FOR tbl IN
      SELECT c.table_name FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = 'public' AND c.column_name = 'run_id' AND t.table_type = 'BASE TABLE'
    LOOP
      EXECUTE format('ALTER TABLE %I DISABLE TRIGGER ALL', tbl);
      EXECUTE format('DELETE FROM %I WHERE run_id = ANY($1)', tbl) USING target_run_ids;
      EXECUTE format('ALTER TABLE %I ENABLE TRIGGER ALL', tbl);
    END LOOP;
    -- agent_artifacts 用的是 produced_by_run_id，不是 run_id，单独扫一遍同一套表发现逻辑。
    FOR tbl IN
      SELECT c.table_name FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = 'public' AND c.column_name = 'produced_by_run_id' AND t.table_type = 'BASE TABLE'
    LOOP
      EXECUTE format('ALTER TABLE %I DISABLE TRIGGER ALL', tbl);
      EXECUTE format('DELETE FROM %I WHERE produced_by_run_id = ANY($1)', tbl) USING target_run_ids;
      EXECUTE format('ALTER TABLE %I ENABLE TRIGGER ALL', tbl);
    END LOOP;
  END IF;

  -- ⚠ `agent_artifacts` 本身按 `thread_id` 归属（不是 agent_id/run_id），是线程的产出物、
  --   属于用户内容，不在本次清除范围内——只删它名下由目标 run 产出的那些
  --   `agent_artifact_versions`（已在上面的 produced_by_run_id 扫描里处理），
  --   不删 `agent_artifacts` 这一行本身。

  -- ② 直接挂 agent_id 的表（含 agent_versions 这张 immutable 表本身、agent_runs 本身、
  --   挂载/权限/审计等一切以 agent_id 关联的表）——通用扫描，与
  --   `purge-ad-hoc-agent.ts` 的 `tablesWithAgentId` 同一逻辑，只是这里额外临时关触发器。
  IF array_length(target_agent_ids, 1) > 0 THEN
    FOR tbl IN
      SELECT c.table_name FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = 'public' AND c.column_name = 'agent_id' AND t.table_type = 'BASE TABLE'
    LOOP
      EXECUTE format('ALTER TABLE %I DISABLE TRIGGER ALL', tbl);
      EXECUTE format('DELETE FROM %I WHERE agent_id = ANY($1)', tbl) USING target_agent_ids;
      EXECUTE format('ALTER TABLE %I ENABLE TRIGGER ALL', tbl);
    END LOOP;

    DELETE FROM capability_listings WHERE kind = 'agent' AND name = ANY(agent_names);
    DELETE FROM agents WHERE id = ANY(target_agent_ids);
  END IF;

  -- ③ Skill 侧：skill_version_files 按 version_id 挂在 skill_versions 下，
  --   skill_versions/其余表按 skill_id 挂——同样先关触发器再删。
  IF array_length(target_skill_ids, 1) > 0 THEN
    IF array_length(target_skill_version_ids, 1) > 0 THEN
      ALTER TABLE skill_version_files DISABLE TRIGGER ALL;
      DELETE FROM skill_version_files WHERE version_id = ANY(target_skill_version_ids);
      ALTER TABLE skill_version_files ENABLE TRIGGER ALL;
    END IF;

    FOR tbl IN
      SELECT c.table_name FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = 'public' AND c.column_name = 'skill_id' AND t.table_type = 'BASE TABLE'
         AND c.table_name <> 'skill_versions'
    LOOP
      EXECUTE format('ALTER TABLE %I DISABLE TRIGGER ALL', tbl);
      EXECUTE format('DELETE FROM %I WHERE skill_id = ANY($1)', tbl) USING target_skill_ids;
      EXECUTE format('ALTER TABLE %I ENABLE TRIGGER ALL', tbl);
    END LOOP;

    -- skill_versions 放最后：上面已经清空引用它的行（skill_version_files 等）。
    ALTER TABLE skill_versions DISABLE TRIGGER ALL;
    DELETE FROM skill_versions WHERE skill_id = ANY(target_skill_ids);
    ALTER TABLE skill_versions ENABLE TRIGGER ALL;

    DELETE FROM capability_listings
     WHERE kind = 'skill' AND (id = ANY(target_skill_ids) OR name IN ('上会审阅', '投后管理报告'));
    DELETE FROM skills WHERE id = ANY(target_skill_ids);
  END IF;
END $$;
