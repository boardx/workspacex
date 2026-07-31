-- 0030 F81: 挂到项目环节 —— 固定快照绑定 + 范围投影 + 解除留痕
-- (uc-6-0 R3步骤7 / R4 A3 / E1 / R12 V4 V9, contracts/interview/domain.md `StepAttachment` · I-30)
--
-- ## 这张表是什么
--
-- domain.md：`StepAttachment { id, interviewId, projectId, stepId, pinnedVersionId,
-- attachedBy, attachedAt, detachedAt? }`，并写明「挂载是**独立关系**，不是把访谈搬进项目；
-- 一场可挂多个环节，也可以永不挂载」。所以它是一张独立的关系表，不是 `interview_sessions`
-- 上的两个列。
--
-- ## 「固定快照」在这里是什么，以及为什么不能按字面读
--
-- 0012 的头部已经把这条陷阱写清楚过一次：`artifact_versions` 的每一行**按构造就是**不可变
-- 快照，所以「pinnedVersionId 指向一个 version」这个字面条件对任何输入都成立 ——
-- `REQUIRES_PINNED` 不可达，一道其全部价值就是「会拒绝」的门永远不会拒绝。
-- 本仓已经把这种形态记过九次：「全绿但空转」。
--
-- 因此这里采用**与 F07 逐字同一条**规则（D-30 跨束同码，contracts/interview I-30 明写
-- 「artifact 束 I-14 是同一条」）：
--
--   citable(version) ⟺ ∃ binding b : b.mode = 'pinned' ∧ b.pinned_version_id = version
--
-- ⚠ **已知重复，报告而不是静默照抄**：这条谓词此刻在仓库里有三处表达 ——
--   ① `src/domain/artifact/downstream-eligibility.ts` 的 `judgeCitation`（纯函数，权威）
--   ② 0012 的 `downstream_reference_requires_pinned()`（内联 EXISTS）
--   ③ 本文件
--   本文件把它提成一个**可复用的 SQL 函数** `kernel_version_is_pinned()` 并调用它，
--   而不是第三次内联同一段 EXISTS；0012 早于它存在，收敛 0012 需要改一个已合入的迁移，
--   不在 F81 范围内，故**列为已知重复并给出收敛路径**（把 0012 的函数体改成调用同一个
--   `kernel_version_is_pinned()`），不在这里顺手动它。
--
-- ## 挂载如何让「该项目成员可见」，以及为什么不是新写一条可见性规则
--
-- V4① 要求「挂载关系建立且**该项目成员可见**」，V4② 要求「解除挂载后**回到无项目状态**
-- 且产出仍在」。F80 的服务端过滤只有一个落点 —— `pg-interview-scope-repository.ts` 的
-- `VISIBILITY_PREDICATE`，其第三支是 `s.project_id IS NOT NULL ∧ 看的人是该项目成员`。
--
-- 所以让项目成员看见的**唯一**不绕过谓词的做法，就是让 `interview_sessions.project_id`
-- 真的变成那个项目。本文件因此维护一个**派生**投影：
--
--   project_id := 最早的一条**活着的**挂载所指向的 project_id（没有活挂载 ⇒ NULL）
--
-- 在这里再写一条「挂载了也算可见」的 OR 分支，就是把 F80 那条谓词变成两处事实源 ——
-- 本项目已五次因此漂移。
--
-- ## `project_id_from_attachment`：一个必须存在的比特
--
-- 上面那条派生**不能无条件覆盖** `project_id`：一场在项目里创建出来的访谈
-- （F84 的路径）本来就有 project_id，把它挂到另一个项目的环节时，若按派生覆盖，
-- 这场访谈会被**静默改籍**；而解除挂载时又会被派生成 NULL，等于凭空把它从原项目里删掉。
-- 于是 `interview_sessions` 多一列布尔：这一列的 project_id 是不是挂载给的。
-- 它不是第二份「这场访谈属于哪个项目」的事实 —— 它记的是那个事实的**来源**，
-- 而来源在只有一个列的情况下是不可恢复的。写者只有本文件的派生函数一个。
--
-- ## 这里**没有**什么
--
-- `STEP_CLOSED_OR_ARCHIVED`（uc-6-0/E1）**无法在本仓求值**：`step_id` 没有外键，因为
-- phase-00 到今天都没有 `steps` 表（0008 的头部为 `artifact_bindings` 记过同一件事）。
-- 造一个「永远说 open」的可空查表来假装覆盖，比没有这道检查更糟 —— 它读起来像覆盖。
-- 故：**声明为不可求值并报告**，不伪造。
--
-- 可独立重放：全程 IF NOT EXISTS / CREATE OR REPLACE / DROP-then-CREATE，
-- 因为 migrate:check 会忽略版本表强制重放。

-- ---------------------------------------------------------------------------------------
-- 「这个版本是不是固定快照」—— 一个函数，不是第三段内联 EXISTS
-- ---------------------------------------------------------------------------------------
-- 与 `judgeCitation` 同义：eligibility 是**绑定**的属性不是版本的属性。
-- `live` 在读取时解析到 head（读者看到的不是引用者看到的），`draft` 根本不在项目侧。
CREATE OR REPLACE FUNCTION kernel_version_is_pinned(p_org_id text, p_version_id text)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM artifact_bindings b
     WHERE b.org_id = p_org_id
       AND b.mode = 'pinned'
       AND b.pinned_version_id = p_version_id
  );
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION kernel_version_is_pinned(text, text) IS
  'D-30 / artifact I-14 / interview I-30：citable(version) ⟺ 存在一条 pinned 绑定恰好钉住它。'
  '不是「这个版本存在」—— 每一行 artifact_versions 按构造都不可变，那种读法让 REQUIRES_PINNED 不可达。';

-- ---------------------------------------------------------------------------------------
-- 挂载关系
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interview_step_attachments (
  id                text PRIMARY KEY,
  org_id            text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- ON DELETE CASCADE：删组织时要能拆干净。单独删一场访谈在 uc-6-0 里不存在
  -- （0020 刻意不给运行时角色 DELETE），所以这条级联在生产路径上不可达。
  interview_id      text NOT NULL REFERENCES interview_sessions (id) ON DELETE CASCADE,
  project_id        text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  -- 无外键：见头部。非空校验是因为「挂到 ''」占着一个真环节的唯一性槽位却指向虚无。
  step_id           text NOT NULL CHECK (length(step_id) > 0),
  -- **本表的理由**。挂的是一条不可变版本行，不是可变的 artifact：
  -- 一个只写 artifact_id 的挂载会跟着上游往前走，而「这个环节引用的是当时那份」就静默变假了。
  pinned_version_id text NOT NULL REFERENCES artifact_versions (id) ON DELETE CASCADE,
  attached_by       text NOT NULL,
  attached_at       timestamptz NOT NULL DEFAULT now(),
  -- 解除 = 打上 detached_at，**不是删行**（R4 A3「挂载可解除且留痕」）。
  detached_at       timestamptz NULL,
  detached_by       text NULL,
  CONSTRAINT interview_step_attachments_detach_pair
    CHECK ((detached_at IS NULL) = (detached_by IS NULL))
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_step_attachments_detach_pair') THEN
    ALTER TABLE interview_step_attachments
      ADD CONSTRAINT interview_step_attachments_detach_pair
      CHECK ((detached_at IS NULL) = (detached_by IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_step_attachments_step_id_check') THEN
    ALTER TABLE interview_step_attachments
      ADD CONSTRAINT interview_step_attachments_step_id_check CHECK (length(step_id) > 0);
  END IF;
END
$$;

-- 一场访谈对同一个环节只能有**一条活着的**挂载。
-- 部分唯一索引而不是普通 UNIQUE：解除后再挂回同一环节是正常操作（A3），
-- 普通 UNIQUE 会把「重新挂上」变成一次冲突，于是实现者就会去删旧行 —— 留痕当场没了。
CREATE UNIQUE INDEX IF NOT EXISTS interview_step_attachments_active_uniq
  ON interview_step_attachments (org_id, interview_id, project_id, step_id)
  WHERE detached_at IS NULL;

CREATE INDEX IF NOT EXISTS interview_step_attachments_interview_idx
  ON interview_step_attachments (org_id, interview_id, attached_at);
CREATE INDEX IF NOT EXISTS interview_step_attachments_step_idx
  ON interview_step_attachments (org_id, project_id, step_id);

-- ---------------------------------------------------------------------------------------
-- 门 ①：只有固定快照能被挂（REQUIRES_PINNED）
-- ---------------------------------------------------------------------------------------
-- 在**数据库里**而不只在用例里，理由与 0012 相同：将来还会有别的写者，
-- 而只写在一个用例里的规则，有效期截止到第二个用例出现。
CREATE OR REPLACE FUNCTION interview_attachment_requires_pinned() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM artifact_versions v
     WHERE v.id = NEW.pinned_version_id AND v.org_id = NEW.org_id
  ) THEN
    -- 外键只保证「是某个版本」，它不是租户感知的：别的租户的版本会被外键愉快接受。
    -- 与别处同一个答案：不存在，而不是「存在但不属于你」。
    RAISE EXCEPTION
      'NO_INTERVIEW_ACCESS: version % is not a version in organization %',
      NEW.pinned_version_id, NEW.org_id
      USING ERRCODE = 'raise_exception';
  END IF;

  IF NOT kernel_version_is_pinned(NEW.org_id, NEW.pinned_version_id) THEN
    RAISE EXCEPTION
      'REQUIRES_PINNED: version % is not pinned to any project step, so interview % cannot cite it at step %',
      NEW.pinned_version_id, NEW.interview_id, NEW.step_id
      USING ERRCODE = 'raise_exception',
            DETAIL  = 'A live binding resolves to the head at read time and a draft is not on the project side at all; neither promises a later reader the bytes the attacher saw.',
            HINT    = 'Pin the artifact to a step first (bindToProjectStep / upgradeBinding), then attach the interview to the pinned version.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS interview_attachment_requires_pinned_trg ON interview_step_attachments;
CREATE TRIGGER interview_attachment_requires_pinned_trg
  BEFORE INSERT ON interview_step_attachments
  FOR EACH ROW EXECUTE FUNCTION interview_attachment_requires_pinned();

-- ---------------------------------------------------------------------------------------
-- 门 ②：挂上之后，快照不动
-- ---------------------------------------------------------------------------------------
-- 这是「固定快照绑定」的**反向**那一半：上游继续往前走是正常的（pinVersion 每天都在发生），
-- 而已经挂上的那条引用必须仍然指向当初那一份。
--
-- 光靠「不去改它」是不够的：`UPDATE ... SET pinned_version_id = <head>` 是一句合法 SQL，
-- 它会让所有「读快照」的断言继续全绿（因为它们读的就是这一列），而这一列已经跟着上游走了。
-- 所以唯一允许的 UPDATE 是打解除标记，其余一律拒绝。
CREATE OR REPLACE FUNCTION interview_attachment_snapshot_frozen() RETURNS trigger AS $$
BEGIN
  IF NEW.pinned_version_id IS DISTINCT FROM OLD.pinned_version_id THEN
    RAISE EXCEPTION
      'SNAPSHOT_IMMUTABLE: attachment % is pinned to % and cannot be re-pointed at %',
      OLD.id, OLD.pinned_version_id, NEW.pinned_version_id
      USING ERRCODE = 'raise_exception',
            DETAIL  = 'Pinning is what makes the source moving harmless; moving the pin re-introduces the drift it exists to prevent (D-30).',
            HINT    = 'Detach and attach again if the step should cite a newer snapshot -- both acts are audited.';
  END IF;

  IF NEW.interview_id IS DISTINCT FROM OLD.interview_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.step_id    IS DISTINCT FROM OLD.step_id
     OR NEW.org_id     IS DISTINCT FROM OLD.org_id
     OR NEW.attached_by IS DISTINCT FROM OLD.attached_by
     OR NEW.attached_at IS DISTINCT FROM OLD.attached_at THEN
    RAISE EXCEPTION
      'attachment % cannot be re-targeted (interview/project/step/attacher are its identity); detach and attach a new one instead',
      OLD.id
      USING ERRCODE = 'raise_exception';
  END IF;

  -- 解除是**一次性**的。允许把 detached_at 抹回 NULL，等于让「这条挂载曾经被解除过」
  -- 可以被无痕撤销 —— 留痕的全部意义就在于它不可撤销。
  IF OLD.detached_at IS NOT NULL AND NEW.detached_at IS DISTINCT FROM OLD.detached_at THEN
    RAISE EXCEPTION
      'attachment % is already detached at %; detachment is not reversible (it is the trail)',
      OLD.id, OLD.detached_at
      USING ERRCODE = 'raise_exception';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS interview_attachment_snapshot_frozen_trg ON interview_step_attachments;
CREATE TRIGGER interview_attachment_snapshot_frozen_trg
  BEFORE UPDATE ON interview_step_attachments
  FOR EACH ROW EXECUTE FUNCTION interview_attachment_snapshot_frozen();

-- ---------------------------------------------------------------------------------------
-- 门 ③：解除 ≠ 删除
-- ---------------------------------------------------------------------------------------
-- 0007 / 0008 / 0012 的同一条教训：只在 UPDATE 上守的规则，被 `DELETE` 一句绕过。
-- 删掉一条挂载行，界面上与「解除挂载」一模一样，而 V9 要求的那条审计线索没了。
-- 残留开口与那三处同型：**父行已经不在**时放行 —— 那说明本行是被级联带走的，不是被人删的。
--
-- ⚠ 这里比 0012 多认一个父：`interview_sessions`。理由不是方便，是它同样删不掉 ——
--   0020 给运行时角色的是 SELECT / INSERT / UPDATE，**没有 DELETE**，
--   uc-6-0 里也没有「删一场访谈」这个操作（解除挂载 ≠ 删除）。所以能走到这个分支的，
--   只有以 owner 身份做的拆库/清理，与「整个组织被删除」是同一类动作。
--   若哪天真的给运行时角色开了 DELETE，这个开口就会变宽 —— 那一天要一起复核这三行。
CREATE OR REPLACE FUNCTION interview_attachment_undeletable() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = OLD.org_id) THEN
    RETURN OLD;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM interview_sessions s WHERE s.id = OLD.interview_id) THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    'attachment % cannot be deleted; detaching sets detached_at and keeps the trail (uc-6-0 R4 A3)',
    OLD.id
    USING ERRCODE = 'raise_exception',
          DETAIL  = 'Deleting the interview, the project or the cited version reaches this row by cascade and is refused for the same reason.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS interview_attachment_undeletable_trg ON interview_step_attachments;
CREATE TRIGGER interview_attachment_undeletable_trg
  BEFORE DELETE ON interview_step_attachments
  FOR EACH ROW EXECUTE FUNCTION interview_attachment_undeletable();

-- ---------------------------------------------------------------------------------------
-- 范围投影：让 F80 那条谓词自己算出「项目成员可见」
-- ---------------------------------------------------------------------------------------
ALTER TABLE interview_sessions
  ADD COLUMN IF NOT EXISTS project_id_from_attachment boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN interview_sessions.project_id_from_attachment IS
  'F81：本行的 project_id 是**挂载**给的（true）还是访谈自己就属于那个项目（false）。'
  '唯一写者是 interview_attachment_project_projection()。它记的不是「属于哪个项目」，'
  '而是那个事实的来源 —— 只有一个列时来源不可恢复，于是解除挂载会把创建时的归属一起抹掉。';

CREATE OR REPLACE FUNCTION interview_attachment_project_projection() RETURNS trigger AS $$
DECLARE
  target_interview text;
  derived_project  text;
  from_attachment  boolean;
  current_project  text;
BEGIN
  target_interview := COALESCE(NEW.interview_id, OLD.interview_id);

  SELECT s.project_id, s.project_id_from_attachment
    INTO current_project, from_attachment
    FROM interview_sessions s
   WHERE s.id = target_interview AND s.org_id = COALESCE(NEW.org_id, OLD.org_id);

  -- 这场访谈本来就属于某个项目（不是挂载给的）⇒ 挂载**不改籍**。
  -- domain.md：「挂载是独立关系，不是把访谈搬进项目」。
  IF current_project IS NOT NULL AND NOT from_attachment THEN
    RETURN NULL;
  END IF;

  SELECT a.project_id INTO derived_project
    FROM interview_step_attachments a
   WHERE a.interview_id = target_interview
     AND a.org_id = COALESCE(NEW.org_id, OLD.org_id)
     AND a.detached_at IS NULL
   ORDER BY a.attached_at ASC, a.id ASC
   LIMIT 1;

  UPDATE interview_sessions s
     SET project_id = derived_project,
         project_id_from_attachment = (derived_project IS NOT NULL)
   WHERE s.id = target_interview
     AND s.org_id = COALESCE(NEW.org_id, OLD.org_id)
     AND (s.project_id IS DISTINCT FROM derived_project
          OR s.project_id_from_attachment IS DISTINCT FROM (derived_project IS NOT NULL));

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION interview_attachment_project_projection() IS
  'V4①②：挂上 ⇒ project_id 变成那个项目，于是 F80 的 VISIBILITY_PREDICATE 第三支自己就让'
  '项目成员看见了；解除最后一条 ⇒ 回到 NULL（「不属于任何项目」），而访谈行与产出都还在。'
  '这里刻意不新写一条可见性规则 —— 那会让服务端过滤有两处事实源。';

DROP TRIGGER IF EXISTS interview_attachment_project_projection_trg ON interview_step_attachments;
CREATE TRIGGER interview_attachment_project_projection_trg
  AFTER INSERT OR UPDATE ON interview_step_attachments
  FOR EACH ROW EXECUTE FUNCTION interview_attachment_project_projection();

-- ---------------------------------------------------------------------------------------
-- RLS：与其它每张租户表同一条规则
-- ---------------------------------------------------------------------------------------
-- kernel_tenant_table_audit()（0004）在这张表存在的那一刻就从 catalog 里发现它，
-- 所以这一段一旦被删掉，verify-rls.sh 与 rls-cross-tenant-zero-leak 会红。
ALTER TABLE interview_step_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_step_attachments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS interview_step_attachments_tenant ON interview_step_attachments;
CREATE POLICY interview_step_attachments_tenant ON interview_step_attachments
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON interview_step_attachments FROM app_rw;

-- SELECT / INSERT / UPDATE，**没有 DELETE**：解除是 UPDATE，删除由上面的触发器拒绝，
-- 而给一个不存在的操作发权限，正是它的第一版实现变成一句临时 DELETE 的方式。
GRANT SELECT, INSERT, UPDATE ON interview_step_attachments TO app_rw;

-- F22 的停用冻结（三条 RESTRICTIVE：INSERT / UPDATE / DELETE）。
-- ⚠ 必须显式调用：0014 的编号在前，首次跑迁移时本表还不存在。
-- 少了这一行的表现极具欺骗性 —— 新库上本表**没有**冻结，而 F22 的断言仍然全绿。
-- 规则本身仍只声明在 0014，在这里抄一遍三条 CREATE POLICY 才是第二份事实源。
SELECT kernel_apply_org_freeze_policies();

COMMENT ON TABLE interview_step_attachments IS
  'F81: 访谈 → 项目环节的挂载关系（domain.md StepAttachment）。挂的是一条不可变的 '
  'artifact_versions 行，且该版本必须已被某条 pinned 绑定钉住（D-30 / I-30，与 F07 同一条规则）。'
  '解除是 detached_at 而不是删行；快照挂上之后不可改指。append-only 语义：无 DELETE。';
