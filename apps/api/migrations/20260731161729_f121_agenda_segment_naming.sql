-- F121: 议程环节命名单源收敛 —— phase-00 的 step_id 改名对齐为 agenda_segment_id
-- (Q-3 B 裁「① 改名对齐」, contracts/project/domain.md I-P20, contracts/project/MIGRATION-IMPACT.md 第二节)
--
-- ## 这支迁移做什么，以及为什么不改 0008 / 0030
--
-- `artifact_bindings.step_id`（0008）与 `interview_step_attachments.step_id`（0030）是
-- phase-00 落库时用的旧字段名。Q-3 B 裁「改名对齐」把它改成全仓单源的
-- `agenda_segment_id`（D-03a）。0008 与 0030 都是已合入 main 的 passing 迁移，
-- **不改它们**——本文件只做一支新增的 `ALTER TABLE ... RENAME COLUMN`。
--
-- `RENAME COLUMN` 在 Postgres 里保留列的全部约束（CHECK / UNIQUE / 外键 / 索引）不变，
-- 只是这些约束的定义文本里会自动换成新列名（`pg_get_constraintdef` 会证明这一点，见
-- `apps/api/tests/project/binding-segment-fk-no-orphan.test.ts`），约束与索引的**名字**
-- 本身不含 `step_id` 这个禁用 token（`artifact_bindings_uniq_step` /
-- `artifact_bindings_segment_fkey` 等都以 `_step` 或语义词结尾，不是 `_step_id`），
-- 因此本迁移不需要连带 RENAME CONSTRAINT / RENAME INDEX——**这句话本身没错，但不够**。
--
-- ⚠ 2026-08-01 更正（issue #235）：0008/0030 后来还是被改了，但改的不是"改名"这件事，
-- 是一个不相关的、`IF NOT EXISTS` 本身治不了的问题——0008/0030 里几条
-- `CREATE INDEX IF NOT EXISTS` 语句字面写死了 `step_id`，`migrate:check` 强制重放这两
-- 个文件本身时（它们排在本文件之前，重放到它们时列已经被本文件改名），Postgres 在
-- 判定"这个索引名是否已存在"之前就先解析了列名，照样报错——`IF NOT EXISTS` 只挡得住
-- 语句执行，挡不住列名解析。这跟"改名要不要连带 RENAME INDEX"是两回事：不需要
-- RENAME INDEX（本节说的没错，改名后已有索引的定义会被 Postgres 自动更新），但
-- 0008/0030 自己的语句在被重放时用的是没被改名影响到的、当初写死的字面文本，得让
-- 它们自己知道"如果列已经不叫这个名字了，就跳过"。详细原因与修法见 0008/0030 文件内
-- 对应位置的注释，不在此重复。
--
-- 两个引用 `step_id` 列的触发器函数（0008 的 `binding_mode_monotonic`、0030 的
-- `interview_attachment_requires_pinned` / `interview_attachment_snapshot_frozen`）用
-- `CREATE OR REPLACE FUNCTION` 在本文件重新声明，列名换成 `agenda_segment_id`——
-- 这是 REPLACE 一个已存在函数的定义，不是编辑 0008/0030 的文件文本。
--
-- 可独立重放：全程走 RENAME COLUMN（对已改过名的库是 no-op，用 DO 块判断是否已改）、
-- CREATE OR REPLACE FUNCTION，因为 migrate:check 会忽略版本表强制重放。

-- ---------------------------------------------------------------------------------------
-- 一、`artifact_bindings.step_id` → `agenda_segment_id`
-- ---------------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'artifact_bindings' AND column_name = 'step_id'
  ) THEN
    ALTER TABLE artifact_bindings RENAME COLUMN step_id TO agenda_segment_id;
  END IF;
END $$;

-- `binding_mode_monotonic`（0008）比较 NEW/OLD 的环节字段，字面引用了 step_id。
CREATE OR REPLACE FUNCTION binding_mode_monotonic() RETURNS trigger AS $$
DECLARE
  rank_old integer;
  rank_new integer;
BEGIN
  IF NEW.artifact_id <> OLD.artifact_id
     OR NEW.project_id <> OLD.project_id
     OR NEW.agenda_segment_id <> OLD.agenda_segment_id
     OR NEW.org_id <> OLD.org_id THEN
    RAISE EXCEPTION
      'binding % cannot be re-targeted (artifact/project/segment are its identity); create a new binding instead',
      OLD.id;
  END IF;

  rank_old := CASE OLD.mode WHEN 'draft' THEN 0 WHEN 'live' THEN 1 ELSE 2 END;
  rank_new := CASE NEW.mode WHEN 'draft' THEN 0 WHEN 'live' THEN 1 ELSE 2 END;

  IF rank_new < rank_old THEN
    RAISE EXCEPTION
      'CANNOT_DOWNGRADE: binding % is %, which cannot become % (invariant I-11 / A3)',
      OLD.id, OLD.mode, NEW.mode
      USING ERRCODE = 'raise_exception',
            HINT = 'A pinned snapshot may already be cited; correct it by pinning a new binding elsewhere.';
  END IF;

  IF OLD.mode = 'pinned' AND NEW.pinned_version_id IS DISTINCT FROM OLD.pinned_version_id THEN
    RAISE EXCEPTION
      'CANNOT_DOWNGRADE: binding % is pinned to % and cannot be re-pointed at % (invariant I-8)',
      OLD.id, OLD.pinned_version_id, NEW.pinned_version_id
      USING ERRCODE = 'raise_exception',
            HINT = 'Pinning is what makes the source moving harmless; moving the pin re-introduces the drift.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON CONSTRAINT artifact_bindings_segment_fkey ON artifact_bindings IS
  'F118 / Q-8 裁决 2: artifact_bindings.agenda_segment_id（改名自 step_id，F121）首次获得外键，'
  '指向 agenda_segments，并要求同一工作坊（project_id = workshop_id，F116 超类型模型下同值域）。'
  '孤儿绑定（指向不存在或不同工作坊的环节）从此不可能存在。';

-- ---------------------------------------------------------------------------------------
-- 二、`interview_step_attachments.step_id` → `agenda_segment_id`
-- ---------------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'interview_step_attachments' AND column_name = 'step_id'
  ) THEN
    ALTER TABLE interview_step_attachments RENAME COLUMN step_id TO agenda_segment_id;
  END IF;
END $$;

-- 门①（0030）：REQUIRES_PINNED 的异常消息里字面引用了 step_id。
CREATE OR REPLACE FUNCTION interview_attachment_requires_pinned() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM artifact_versions v
     WHERE v.id = NEW.pinned_version_id AND v.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION
      'NO_INTERVIEW_ACCESS: version % is not a version in organization %',
      NEW.pinned_version_id, NEW.org_id
      USING ERRCODE = 'raise_exception';
  END IF;

  IF NOT kernel_version_is_pinned(NEW.org_id, NEW.pinned_version_id) THEN
    RAISE EXCEPTION
      'REQUIRES_PINNED: version % is not pinned to any project segment, so interview % cannot cite it at segment %',
      NEW.pinned_version_id, NEW.interview_id, NEW.agenda_segment_id
      USING ERRCODE = 'raise_exception',
            DETAIL  = 'A live binding resolves to the head at read time and a draft is not on the project side at all; neither promises a later reader the bytes the attacher saw.',
            HINT    = 'Pin the artifact to a segment first (bindToProjectStep / upgradeBinding), then attach the interview to the pinned version.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 门②（0030）：快照不动的比对里字面引用了 step_id。
CREATE OR REPLACE FUNCTION interview_attachment_snapshot_frozen() RETURNS trigger AS $$
BEGIN
  IF NEW.pinned_version_id IS DISTINCT FROM OLD.pinned_version_id THEN
    RAISE EXCEPTION
      'SNAPSHOT_IMMUTABLE: attachment % is pinned to % and cannot be re-pointed at %',
      OLD.id, OLD.pinned_version_id, NEW.pinned_version_id
      USING ERRCODE = 'raise_exception',
            DETAIL  = 'Pinning is what makes the source moving harmless; moving the pin re-introduces the drift it exists to prevent (D-30).',
            HINT    = 'Detach and attach again if the segment should cite a newer snapshot -- both acts are audited.';
  END IF;

  IF NEW.interview_id IS DISTINCT FROM OLD.interview_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.agenda_segment_id IS DISTINCT FROM OLD.agenda_segment_id
     OR NEW.org_id     IS DISTINCT FROM OLD.org_id
     OR NEW.attached_by IS DISTINCT FROM OLD.attached_by
     OR NEW.attached_at IS DISTINCT FROM OLD.attached_at THEN
    RAISE EXCEPTION
      'attachment % cannot be re-targeted (interview/project/segment/attacher are its identity); detach and attach a new one instead',
      OLD.id
      USING ERRCODE = 'raise_exception';
  END IF;

  IF OLD.detached_at IS NOT NULL AND NEW.detached_at IS DISTINCT FROM OLD.detached_at THEN
    RAISE EXCEPTION
      'attachment % is already detached at %; detachment is not reversible (it is the trail)',
      OLD.id, OLD.detached_at
      USING ERRCODE = 'raise_exception';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE interview_step_attachments IS
  'F81: 访谈 → 项目环节的挂载关系（domain.md StepAttachment）。挂的是一条不可变的 '
  'artifact_versions 行，且该版本必须已被某条 pinned 绑定钉住（D-30 / I-30，与 F07 同一条规则）。'
  '解除是 detached_at 而不是删行；快照挂上之后不可改指。append-only 语义：无 DELETE。'
  'F121：环节列已由 step_id 改名为 agenda_segment_id（表名本身保留，改名范围只是字段名/动作词）。';
