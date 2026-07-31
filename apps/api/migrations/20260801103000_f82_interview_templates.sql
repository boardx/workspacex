-- F82: 访谈模板数据模型（结构+时长+数据字段+来源）+ 套用即脱钩 + 用过 N 次统计
-- (uc-6-1 R3 / R7, contracts/interview/domain.md `InterviewTemplate` / `TemplateVersion` · I-8 / I-9)
--
-- ## 三张表，各自封一件事
--
-- `interview_templates`             —— 身份 + 当前版本指针（可变：编辑不改身份，只挪指针）。
-- `interview_template_versions`     —— 不可变快照（同构 `artifact_versions`：SHA-256 + 只增不改，
--                                        `updateTemplate` 产生新版本，已建访谈不受影响，A2 / I-9）。
-- `interview_template_applications` —— 套用记录，同时是两件事的唯一事实源：
--     ① `usedCount`（I-8）：`COUNT(*) ... GROUP BY template_id`。本迁移**不建任何计数列**——
--        没有列可写，比「建一列再 REVOKE」更彻底：不是「这一列只能被系统改」，
--        是「压根没有这一列」。
--     ② **套用即脱钩**（I-9）：这一行的 `sections`/`data_fields` 是**这场访谈自己的副本**，
--        写入之后与模板互不影响——模板产生新版本不 touch 这一行，
--        这一行日后被编辑（Outline 编辑器，未来 feature）也不 touch 模板版本行。
--
-- ## 为什么不是把 usedCount 做成一列 + 触发器同步
--
-- 触发器同步得对，`usedCount` 看起来就是「可读不可写」；触发器同步错一次（或者哪天多了一条
-- 旁路写入路径），`usedCount` 就会静默漂移，而「统计值」这三个字全部意义就在于它必须
-- **恒等于**实际套用次数。现查 COUNT 没有漂移的可能——因为它就是那个定义本身。
--
-- ## 这里没有什么
--
-- 没有 `extractTemplateDraft` / `confirmTemplateDraft` 的草案表——反向抽取是另一个 feature
-- （uc-6-1/A3，口径为 [设计]，本迁移不建它的存储）。`source_interview_ids` 列仍然建在
-- `interview_template_versions` 上（domain.md 把它列为 `InterviewTemplate` 的一部分），
-- 默认空数组；抽取入库时如何填它是那个 feature 的事。
--
-- 可独立重放：全程 IF NOT EXISTS / CREATE OR REPLACE / DROP-then-CREATE，
-- 因为 migrate:check 会忽略版本表强制重放。

-- ---------------------------------------------------------------------------------------
-- 模板身份 + 当前版本指针
-- ---------------------------------------------------------------------------------------
-- 组织级跨项目资产（domain.md：「projectId 恒空」），所以没有 project_id 列。
CREATE TABLE IF NOT EXISTS interview_templates (
  id                  text PRIMARY KEY,
  org_id              text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  created_by          text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- 可空：createTemplate 先插身份行再插版本行时，中间态允许为空；两者在同一事务内完成。
  current_version_id  text NULL
);

-- ---------------------------------------------------------------------------------------
-- 不可变版本快照
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interview_template_versions (
  id                   text PRIMARY KEY,
  template_id          text NOT NULL REFERENCES interview_templates (id) ON DELETE CASCADE,
  org_id               text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  version_number       integer NOT NULL CHECK (version_number > 0),
  name                 text NOT NULL CHECK (length(name) > 0),
  goal                 text NOT NULL,
  -- `{name, minutes, order}[]` —— 提纲结构 + 每段时长，contracts `createTemplate.in.sections` 的存储形态。
  sections             jsonb NOT NULL,
  -- `TemplateField[]` —— 要收集的数据字段，三样里最常被漏的第三样（uc-6-1 R7）。
  data_fields          jsonb NOT NULL,
  tags                 text[] NOT NULL DEFAULT '{}',
  -- I-9 / domain.md：「按 artifact_versions 同构管理，SHA-256」。计算方式见
  -- `src/domain/interview/template.ts` 的 `computeTemplateVersionHash`（对 name/goal/sections/
  -- dataFields/tags 的规范化 JSON 取 sha256），与 `domain/artifact/content-hash.ts` 同一个哈希函数。
  content_hash         text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  -- [设计] 反向抽取的来源链（uc-6-1/A3）。本 feature 不实现抽取，只留位置；默认空数组。
  source_interview_ids text[] NOT NULL DEFAULT '{}',
  created_by           text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, version_number)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'interview_templates_current_version_fk'
  ) THEN
    ALTER TABLE interview_templates
      ADD CONSTRAINT interview_templates_current_version_fk
      FOREIGN KEY (current_version_id) REFERENCES interview_template_versions (id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS interview_template_versions_template_idx
  ON interview_template_versions (org_id, template_id, version_number DESC);

-- ---------------------------------------------------------------------------------------
-- 门：版本不可变（A2 / I-9）—— 与 0007 的 SNAPSHOT_IMMUTABLE 同一纪律
-- ---------------------------------------------------------------------------------------
-- `updateTemplate` 产生**新行**，不改旧行；已建访谈引用的旧版本号永远指向当初那份内容。
-- 唯一的例外与 0007 相同：整个组织被删除时的级联，鉴别方式是「父行此刻已经不在」。
CREATE OR REPLACE FUNCTION interview_template_version_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = OLD.org_id) THEN
      RETURN OLD; -- 组织整体拆除的级联，不是针对这一行的删除
    END IF;
    RAISE EXCEPTION
      'TEMPLATE_VERSION_IMMUTABLE: version % of template % cannot be deleted (A2 / I-9)',
      OLD.id, OLD.template_id
      USING ERRCODE = 'raise_exception';
  END IF;

  RAISE EXCEPTION
    'TEMPLATE_VERSION_IMMUTABLE: version % of template % cannot be modified; edits produce a new version instead (updateTemplate, A2 / I-9)',
    OLD.id, OLD.template_id
    USING ERRCODE = 'raise_exception',
          HINT    = 'Call updateTemplate to create a new version; existing applications keep citing this one.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS interview_template_version_immutable_upd ON interview_template_versions;
CREATE TRIGGER interview_template_version_immutable_upd
  BEFORE UPDATE ON interview_template_versions
  FOR EACH ROW EXECUTE FUNCTION interview_template_version_immutable();

DROP TRIGGER IF EXISTS interview_template_version_immutable_del ON interview_template_versions;
CREATE TRIGGER interview_template_version_immutable_del
  BEFORE DELETE ON interview_template_versions
  FOR EACH ROW EXECUTE FUNCTION interview_template_version_immutable();

-- ---------------------------------------------------------------------------------------
-- 套用记录 —— usedCount 的唯一事实源 + 该访谈自己的三样东西副本（脱钩之后的落点）
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interview_template_applications (
  id                   text PRIMARY KEY,
  org_id               text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  template_id          text NOT NULL REFERENCES interview_templates (id) ON DELETE CASCADE,
  template_version_id  text NOT NULL REFERENCES interview_template_versions (id) ON DELETE CASCADE,
  interview_id         text NOT NULL REFERENCES interview_sessions (id) ON DELETE CASCADE,
  -- 脱钩之后**这场访谈自己的**副本。此后模板产生新版本不 touch 这两列；
  -- 这两列被编辑（未来 Outline 编辑器）也不 touch interview_template_versions。
  sections             jsonb NOT NULL,
  data_fields          jsonb NOT NULL,
  applied_by           text NOT NULL,
  applied_at           timestamptz NOT NULL DEFAULT now()
);

-- 一场访谈至多有一条「当前套用」——与 domain.md `InterviewSession.appliedTemplateVersionId`
-- 是单值字段同构：一场访谈同一时刻只引用一个模板版本。
CREATE UNIQUE INDEX IF NOT EXISTS interview_template_applications_interview_uniq
  ON interview_template_applications (org_id, interview_id);

CREATE INDEX IF NOT EXISTS interview_template_applications_template_idx
  ON interview_template_applications (org_id, template_id);

-- ---------------------------------------------------------------------------------------
-- `interview_sessions` 挂上「引用了哪一版模板」（只记引用，内容在上面那张表）
-- ---------------------------------------------------------------------------------------
ALTER TABLE interview_sessions
  ADD COLUMN IF NOT EXISTS applied_template_version_id text NULL
  REFERENCES interview_template_versions (id);

COMMENT ON COLUMN interview_sessions.applied_template_version_id IS
  'F82: 套用时固化的模板版本号（I-9）。只是引用——内容副本在 interview_template_applications。'
  '此列一经写入不再改指：改指等于让已建访谈悄悄跟着模板新版本走，是脱钩要防的那件事。';

-- 「一经写入不再改指」：与 0030 的 snapshot_frozen 同一纪律，只挡这一列的改指，
-- 其余列（archived / tags / when_at 等）仍按 F80/F81 的规则可写。
CREATE OR REPLACE FUNCTION interview_session_template_ref_frozen() RETURNS trigger AS $$
BEGIN
  IF OLD.applied_template_version_id IS NOT NULL
     AND NEW.applied_template_version_id IS DISTINCT FROM OLD.applied_template_version_id THEN
    RAISE EXCEPTION
      'TEMPLATE_REF_IMMUTABLE: interview % already applied template version %; it cannot be re-pointed (I-9)',
      OLD.id, OLD.applied_template_version_id
      USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS interview_session_template_ref_frozen_trg ON interview_sessions;
CREATE TRIGGER interview_session_template_ref_frozen_trg
  BEFORE UPDATE ON interview_sessions
  FOR EACH ROW EXECUTE FUNCTION interview_session_template_ref_frozen();

-- ---------------------------------------------------------------------------------------
-- RLS：与其它每张租户表同一条规则
-- ---------------------------------------------------------------------------------------
-- kernel_tenant_table_audit()（0004）在这三张表存在的那一刻就从 catalog 里发现它们，
-- 所以这一段一旦被删掉，verify-rls.sh 与 rls-cross-tenant-zero-leak 会红。
ALTER TABLE interview_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS interview_templates_tenant ON interview_templates;
CREATE POLICY interview_templates_tenant ON interview_templates
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

ALTER TABLE interview_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_template_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS interview_template_versions_tenant ON interview_template_versions;
CREATE POLICY interview_template_versions_tenant ON interview_template_versions
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

ALTER TABLE interview_template_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_template_applications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS interview_template_applications_tenant ON interview_template_applications;
CREATE POLICY interview_template_applications_tenant ON interview_template_applications
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON interview_templates FROM app_rw;
REVOKE ALL ON interview_template_versions FROM app_rw;
REVOKE ALL ON interview_template_applications FROM app_rw;

-- 模板身份行：套用会更新 current_version_id（编辑）以及可能的元数据，故给 UPDATE。
-- 没有 DELETE——uc-6-1 没有「删模板」这个操作。
GRANT SELECT, INSERT, UPDATE ON interview_templates TO app_rw;
-- 版本表：只增不改。UPDATE/DELETE 被 REVOKE 且被触发器双重挡住（数据库里而不只在用例里）。
GRANT SELECT, INSERT ON interview_template_versions TO app_rw;
-- 套用记录：只增。usedCount 现查 COUNT(*)，没有列可 UPDATE；不给 UPDATE/DELETE 权限。
GRANT SELECT, INSERT ON interview_template_applications TO app_rw;

-- F22 的停用冻结（三条 RESTRICTIVE 策略：INSERT / UPDATE / DELETE）。
-- ⚠ 必须显式调用：0014 的编号在前，首次跑迁移时这三张表还不存在。
SELECT kernel_apply_org_freeze_policies();

COMMENT ON TABLE interview_templates IS
  'F82: 访谈模板身份 + 当前版本指针。组织级跨项目资产（projectId 恒空，故无该列）。';
COMMENT ON TABLE interview_template_versions IS
  'F82: 模板不可变版本快照（同构 artifact_versions，SHA-256）。updateTemplate 产生新版本，'
  '已建访谈的引用（interview_sessions.applied_template_version_id）不受影响（A2 / I-9）。';
COMMENT ON TABLE interview_template_applications IS
  'F82: 套用记录。usedCount 的唯一事实源（COUNT(*) GROUP BY template_id，本表没有可写的计数列，'
  'I-8）；sections/data_fields 是该访谈自己的副本，写入后与模板互不追改（套用即脱钩，I-9）。';
