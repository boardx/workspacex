-- F115: 预设对话下发（编写 / 下发范围校验 / 使用计数=实例数）+ 预设≠实例可见性
-- (phase-01 contracts/chat/domain.md G 组 I-38 / I-39 / I-40 / I-41，uc-8-4)
--
-- ## 这个文件在防什么
--
--   · I-38「使用计数=真实实例数」—— `chat_preset_instances` 的
--     `UNIQUE (preset_id, started_by)` 让「同一人重复开始产生两个实例」这件事
--     在写入这一刻就失败，不是靠应用层记得去重（`presetUsageCount()` 那份纯函数
--     去重是第二道防线，不是唯一防线）。
--
--   · I-39「预设≠实例可见性，两者可见性分开判定」—— 本文件**没有**为
--     `chat_preset_instances` 建任何可见性判定用的列（scope / group_id 之类）。
--     一个实例的可见性就是它绑定的那一行 `chat_threads` 的可见性，走既有的
--     F108 判定路径；`chat_preset_instances` 只是「这个人开始过这个预设」的登记表，
--     它本身不参与任何可见性判定，参与判定的字段一个都不在这张表上——
--     这就是「改一个不影响另一个」在 schema 层面的样子：两件事根本不共享列。
--
--   · I-40「越范围在下发接口即拒绝」—— 见下方 `chat_preset_dispatches` 的唯一约束：
--     真正的范围判定发生在应用层（写入之前），这里的表只负责幂等重放的落点。
--
--   · I-41「预设不得预先批准高影响动作 / 不得预置绕过范围的检索」—— **没有对应的列**，
--     是刻意的：`chat_presets` 不存在任何「预批准标记」或「检索范围覆盖」字段，
--     这两条不变量因此不是靠 CHECK 挡住非法值，而是从 schema 里连输入位都没给。
--
-- ## 已知简化（记在这里，供 F15/组织级 agent-skill 可见性范围落地时回来改）
--
--   · 预设定义**没有**接入 phase-00 `artifact_versions`（domain.md 实体 9 写的是
--     「按 artifact_versions 管理、不可变」）。本表用自己的 `version` 整数做乐观并发，
--     且只保留**当前**版本，不像 F04 那样存每个历史版本的完整快照。
--     理由：接入 artifact 六表模型意味着预设定义要过 `bindToProjectStep` 那一整套
--     绑定/定版语义，而预设不落地为项目产出——它是「可下发的配置」，不是「交付物」，
--     套用同一个机制会让 `referenceForDownstream`（uc-0-1 的引用资格门）多出一个
--     从未打算被下游引用的候选对象。等预设需要「查看历史版本」这个真实需求出现时，
--     再回来判断是否值得接入，不预支这个决定。
--
--   · `org_skills` 是 `org_agents`（0032/F110）同款占位目录，供 `dispatchPreset` 判断
--     `SKILL_OUT_OF_SCOPE` 用。它**不是** 03-skill 的组织级可见性范围权威——那条跨分片
--     依赖（feature_list.json F115 notes「跨分片依赖待确认」）尚未落地，本表只解决
--     「存不存在」，不解决「对谁可见」。`domain/chat/preset-dispatch-scope.ts` 文件头
--     与 `application/chat/dispatch-preset.ts` 文件头写了同一条简化，三处指向同一个缺口，
--     不是三份互相不知道对方的临时决定。
--
-- 可重放：全部 IF NOT EXISTS，`migrate:check` 会强制重放每个文件。

/* ═══════════════ 一、组织 skill 目录（同 org_agents 的占位纪律）═══════════════ */

CREATE TABLE IF NOT EXISTS org_skills (
  org_id   text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  skill_id text NOT NULL,
  name     text NOT NULL,
  PRIMARY KEY (org_id, skill_id)
);

COMMENT ON TABLE org_skills IS
  '组织的 skill 目录（占位，同 0032 的 org_agents）。dispatchPreset 的 SKILL_OUT_OF_SCOPE '
  '判定读它；不是 03-skill/F15 的组织级可见性范围权威——那条跨分片依赖尚未落地。';

/* ═══════════════ 二、预设定义 ═══════════════ */

CREATE TABLE IF NOT EXISTS chat_presets (
  id             text PRIMARY KEY,
  org_id         text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id     text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  opening_prompt text NOT NULL,
  -- agent/skill 引用集合。**不是外键数组**——org_agents/org_skills 是占位目录
  -- （见文件头），对它们建外键会让「目录还没落地时预设建不出来」，本表的写入
  -- 不应受一个尚未成为权威的占位表牵动。存在性校验在应用层 `dispatchPreset` 做。
  skills         text[] NOT NULL DEFAULT '{}',
  agents         text[] NOT NULL DEFAULT '{}',
  version        integer NOT NULL DEFAULT 1,
  created_by     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_presets_project_idx
  ON chat_presets (org_id, project_id);

COMMENT ON COLUMN chat_presets.version IS
  '乐观并发（同 chat_threads.version 的做法）。已知简化：不接 artifact_versions，'
  '只保留当前版本，不存历史快照——见文件头「已知简化」一节。';

/* ═══════════════ 三、下发记录（幂等重放的落点，I-40）═══════════════ */

CREATE TABLE IF NOT EXISTS chat_preset_dispatches (
  id                  text PRIMARY KEY,
  org_id              text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  preset_id           text NOT NULL REFERENCES chat_presets (id) ON DELETE CASCADE,
  -- 下发对象的规范化指纹（domain 层 `presetTargetsFingerprint()`，顺序无关）——
  -- 只用于幂等重放的查找键。
  targets_fingerprint text NOT NULL,
  -- 下发对象的**结构化**存法（指纹之外还留一份），因为 `isActorDispatchTarget`
  -- 要能反过来问「这个人在不在某次下发的目标集合里」——指纹是单向哈希，问不出这个。
  plenary             boolean NOT NULL DEFAULT false,
  group_ids           text[] NOT NULL DEFAULT '{}',
  roles               text[] NOT NULL DEFAULT '{}',
  preset_version      integer NOT NULL,
  target_count        integer NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- 契约「同一 (presetId, targets, version) 重复下发返回同一 dispatchId」的唯一约束：
  -- 重复请求撞到这条约束时，应用层先 SELECT 命中即返回，不会走到 INSERT。
  UNIQUE (preset_id, targets_fingerprint, preset_version)
);

CREATE INDEX IF NOT EXISTS chat_preset_dispatches_org_idx
  ON chat_preset_dispatches (org_id, preset_id);

/* ═══════════════ 四、预设实例（I-38 / I-39）═══════════════ */

CREATE TABLE IF NOT EXISTS chat_preset_instances (
  id         text PRIMARY KEY,
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  preset_id  text NOT NULL REFERENCES chat_presets (id) ON DELETE CASCADE,
  -- 实例绑定的那一条线程——**可见性判定的唯一落点**，见文件头 I-39。
  thread_id  text NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  started_by text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  -- I-38 幂等的数据库级保证：同一人对同一预设的第二次「开始」在这里就失败，
  -- 应用层的 `findInstanceForActor` 先查命中即返回，是幂等语义的读侧一半；
  -- 这条约束是写侧那一半，两者缺一都不完整（同 F109 `chat_transcript_sessions_one_live`
  -- 的两侧纪律）。
  UNIQUE (preset_id, started_by)
);

CREATE INDEX IF NOT EXISTS chat_preset_instances_org_idx
  ON chat_preset_instances (org_id, preset_id);

/* ═══════════════ 五、RLS：与其余租户表同一条规则 ═══════════════ */

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'org_skills', 'chat_presets', 'chat_preset_dispatches', 'chat_preset_instances'
  ]
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

GRANT SELECT, INSERT, UPDATE, DELETE ON org_skills TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON chat_presets TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON chat_preset_dispatches TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON chat_preset_instances TO app_rw;

-- 新建的租户表必须自己补这一次调用（0021/0029/0032 头部同一个坑）。
SELECT kernel_apply_org_freeze_policies();
