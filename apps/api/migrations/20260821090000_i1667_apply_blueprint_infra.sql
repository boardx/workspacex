-- F23 补实现（issue #1667）：`templates.applyBlueprint` 首次接上电——控制器 + 真实
-- `ApplyBlueprintRepository` PG 实现需要的两处 schema 变更。
--
-- ## 一、`agenda_segments.duration` 放开 NOT NULL（人类裁决：P10 已随 F202 落地过期）
--
-- 0731 建表时 `duration` 是 `NOT NULL CHECK (duration > 0)`——当时全仓唯一的写点
-- （`PgAgendaSegmentRepository.create`，手工「＋环节」）确实总有一个用户填的正整数。
-- F202 之后，`applyBlueprint` 的「议程环节」这一类会按蓝本 `flow-agenda` facet 的真实
-- `min` 写这张表，而 facet 未必逐行都填过时长（`apps/web/components/tpl-designer/
-- agenda-panel-editor.tsx` 的既有语义：未填就是没有这一行数据，不是 0 或某个默认值）。
-- 人类裁决（issue #1667）：**不编造 30 分钟之类默认值**——如实处理为「未填」。
-- DB 唯一能诚实表达「未填」的方式是 NULL，所以放开 NOT NULL，CHECK 同步放宽为
-- 「要么是 NULL，要么是正整数」（不允许 0 或负数混进来，同旧约束的下半句）。
--
-- ⚠ 手工「＋环节」路径（`PgAgendaSegmentRepository.create`）不受影响：应用层仍然
--   总是传一个正整数（UI 表单本身有默认值 30），这里放宽的是**数据库**能接受什么，
--   不是把这条既有路径的合法输入集合变宽。
--
-- ## 二、`blueprint_bindings` 补 `project_id` / `version_id`
--
-- 0814（F179/BP-04）建表时只有 `blueprint_id` + `kind`——那一版的调用方
-- （`createProject` 的 BP-08 最小闭环）自己就承认「本轮不写 agenda_segments，
-- 逐段时长无出处」（`KNOWN_CONTRACT_GAPS.P10`，见 `create-project.ts` 头注），
-- 所以当时确实不需要知道「绑的是哪个项目、哪一个具体版本」。
-- `templates.applyBlueprint`（本迁移配套的 controller）现在要为 F29
-- `computeDeviations` 提供 diff 基准（`findProjectBinding` 要读「这个项目绑的是
-- 哪个蓝本版本」），没有 `project_id`/`version_id` 就没有查询入口——这不是新造一张表，
-- 是给已经存在、已经在用的表补上此前没有调用方需要的两列。
--
-- ⚠ 两列都可为空：既有的 `kind='trial-run'` 行（F179 起持续产生）没有项目/版本概念，
--   补列不回填、不强制。`kind='project'` 的新行由本迁移配套的 controller 写入时
--   总是带上这两列（应用层保证，不在 DB 层用 CHECK 逐 kind 强制——那需要一条
--   `CHECK (kind <> 'project' OR (project_id IS NOT NULL AND version_id IS NOT NULL))`，
--   本迁移选择先放开，若后续证明有必要再补，不在本次范围内抢先加）。

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'agenda_segments' AND column_name = 'duration' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE agenda_segments ALTER COLUMN duration DROP NOT NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'agenda_segments_duration_check' AND conrelid = 'agenda_segments'::regclass
  ) THEN
    ALTER TABLE agenda_segments DROP CONSTRAINT agenda_segments_duration_check;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'agenda_segments_duration_check' AND conrelid = 'agenda_segments'::regclass
  ) THEN
    ALTER TABLE agenda_segments
      ADD CONSTRAINT agenda_segments_duration_check CHECK (duration IS NULL OR duration > 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'blueprint_bindings' AND column_name = 'project_id'
  ) THEN
    ALTER TABLE blueprint_bindings ADD COLUMN project_id text REFERENCES projects (id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'blueprint_bindings' AND column_name = 'version_id'
  ) THEN
    ALTER TABLE blueprint_bindings ADD COLUMN version_id text REFERENCES blueprint_versions (id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS blueprint_bindings_project_idx
  ON blueprint_bindings (project_id) WHERE project_id IS NOT NULL;

-- `blueprint_bindings` 刚获得的 `project_id` 列（单列外键指向 `projects`）让它第一次
-- 符合 `kernel_project_archive_candidate_tables()`（issue #342）判据①，
-- 需要项目归档冻结（`kernel_apply_project_archive_policies()`，F124/#342）——
-- 不是 F22 的组织冻结（那三条 `_org_frozen_*` 策略 `blueprint_bindings` 在 F179
-- 建表时就已经装过）。
--
-- **必须在本迁移里调用，不能指望后面随便哪个迁移顺手调一次**：#342 自己的教训逐字
-- 写在它文件头——F46 建表时没调用，新库首次部署留了真实缺口，`migrate:check` 的强制
-- 重放"碰巧"补上是意外而不是设计。本文件建索引之后立刻实测撞上同一种失败（重放后
-- schema 摘要不一致），调用挪到这里即修复——同 #342 那句「谁新增了受项目归档冻结
-- 影响的列，谁在自己的迁移里调用，不借道下一个人」。
SELECT kernel_apply_project_archive_policies();

COMMENT ON COLUMN agenda_segments.duration IS
  'F23（#1667）: NULL = 该环节的时长未从蓝本 flow-agenda facet 拿到真实值（未填/解析失败），'
  '如实留空，不编造默认值。手工「＋环节」路径的应用层仍总是传正整数，不受此列放宽影响。';

COMMENT ON COLUMN blueprint_bindings.project_id IS
  'F23（#1667）: kind=''project'' 的绑定记录挂哪个项目；kind=''trial-run'' 恒 NULL。';

COMMENT ON COLUMN blueprint_bindings.version_id IS
  'F23（#1667）: kind=''project'' 的绑定记录挂哪一条 blueprint_versions（快照引用，供 F29 '
  'computeDeviations 的 diff 基准查询）；kind=''trial-run'' 恒 NULL。';
