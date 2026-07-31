-- F97: 访谈对象数据模型 —— 六列 + 两处投影一致 + 同意书状态单一来源
-- (uc-6-7 R3, contracts/interview/domain.md 「Subject」/ I-19 / I-20, coverage uc-6-7)
--
-- ## 这张表是什么，不是什么
--
-- `interview_subjects` 是 R3-2 的六列里能在这张表上落盘的五列：
-- `对象`(display_name) / `部门角色`(role_title) / `联系方式`(contact_*)
-- / `背景与要问什么`(background_and_questions) / `方式`(mode)。
-- **第六列「状态」不在这张表上** —— domain.md 把 `Subject.consentStatus` 明写成
-- 「派生自 `ConsentBits`，不另存」（I-19/I-20）。这不是本迁移忘了加一列，
-- 是这一列**故意不存在**：状态是查询时算出来的，磁盘上只有一份同意书事实
-- （`interview_consent_submissions`），没有第二份状态。
--
-- ## 「两处投影一致」怎么落在结构上
--
-- 项目侧组卡按 `group_id` 取这张表；访谈侧受访者名单按 `interview_session_subjects`
-- 的关联取同一张表。两条查询路径指向**同一行**，不是两张表各存一份 ——
-- 这正是 `object-two-projections-single-record.test.ts` 要断言的事。
--
-- ## 联系方式为什么现在只有两列、没有加密/解密/审计逻辑
--
-- `contact_cipher`（密文，占位）与 `contact_mask`（默认展示的掩码）两列已经按
-- O-39「加密存储、界面只展示掩码」建好位置，但**取明文的接口、查看留痕**是 F98
-- 的范围（「联系方式遮盖/查看留痕/导出排除」）。F97 只负责这两列**存在**且
-- 默认路径不返回明文；真正的加解密与审计留给 F98，本迁移不假装已经做完那件事。
--
-- ## `interview_consent_submissions` 为什么现在就建，而不是等 F86/F87
--
-- I-20 的断言是「改访谈侧同意位 → 项目侧组卡状态同步变化；查表结构断言无第二列/第二表」——
-- 这条断言天然要求**有且只有一处**存同意位事实。F86/F87 会建签署令牌、门户、
-- 授权页外壳，但那些都是"怎么把同意位写进来"的通道；"同意位写在哪一张表"
-- 是本 feature（F97）该钉死的事，晚钉等于让 F87 自己选一个地方存，
-- 而"选哪"正是本项目栽过五次的「同一事实两处声明」的起点。
-- append-only（I-16）：只给 INSERT 权限，不给 UPDATE/DELETE。
--
-- 可独立重放：全程 IF NOT EXISTS，约束回填走 DO 块。

CREATE TABLE IF NOT EXISTS interview_subjects (
  id                        text PRIMARY KEY,
  org_id                    text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- 项目侧组卡的挂载点。未归组＝「不产生转写回流目标」（R4/A1），不是异常，可空。
  group_id                  text NULL REFERENCES groups (id) ON DELETE SET NULL,
  display_name              text NOT NULL CHECK (length(display_name) > 0),
  role_title                text NOT NULL DEFAULT '',
  org_name                  text NULL,
  background_and_questions  text NOT NULL DEFAULT '',
  mode                      text NOT NULL DEFAULT 'interview'
                              CHECK (mode IN ('observation', 'interview', 'group_interview')),
  source_kind               text NOT NULL DEFAULT 'human'
                              CHECK (source_kind IN ('human', 'virtual')),
  -- O-39：密文存储、界面默认只给掩码。加解密与查看留痕是 F98 的范围（本迁移只占位）。
  contact_cipher            text NULL,
  contact_mask              text NULL,
  created_by                text NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_subjects_mode_check') THEN
    ALTER TABLE interview_subjects
      ADD CONSTRAINT interview_subjects_mode_check
      CHECK (mode IN ('observation', 'interview', 'group_interview'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_subjects_source_kind_check') THEN
    ALTER TABLE interview_subjects
      ADD CONSTRAINT interview_subjects_source_kind_check
      CHECK (source_kind IN ('human', 'virtual'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS interview_subjects_group_idx
  ON interview_subjects (org_id, group_id, created_at DESC);

-- ---------------------------------------------------------------------------------------
-- 访谈侧名单关联 —— 「同一条记录的第二个投影」的取数关联，不是第二份对象数据
-- ---------------------------------------------------------------------------------------
-- 对应 domain.md `InterviewSession.requiredSubjectIds` 的存储形态。哪些对象被 UC-6.2
-- 向导第二步选中、成为某场访谈的受访者名单，记在这张关联表上；`interview_subjects`
-- 本身不因此复制一份行 —— 名单展示查的还是同一张 `interview_subjects`。
-- 谁把对象排进具体一场访谈（三步向导）是 F84 的活；这里只建它需要落盘的关联结构，
-- 不建向导本身。
CREATE TABLE IF NOT EXISTS interview_session_subjects (
  interview_session_id text NOT NULL REFERENCES interview_sessions (id) ON DELETE CASCADE,
  subject_id            text NOT NULL REFERENCES interview_subjects (id) ON DELETE CASCADE,
  org_id                 text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  added_by               text NOT NULL,
  added_at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (interview_session_id, subject_id)
);

CREATE INDEX IF NOT EXISTS interview_session_subjects_subject_idx
  ON interview_session_subjects (org_id, subject_id);

-- ---------------------------------------------------------------------------------------
-- 同意书事实 —— `Subject.consentStatus` 唯一的派生来源（I-19 / I-20）
-- ---------------------------------------------------------------------------------------
-- append-only（I-16 的最小落地）：每次提交追加一行，不覆盖；"当前状态"＝该
-- (interview_session_id, subject_id) 组合下 `submitted_at` 最大的一行。
-- 四项同意位的完整分发流程（签署令牌、门户、授权页渲染快照）是 F86/F87 的范围；
-- 这张表只钉死"同意位事实存在哪"，好让 F87 有且只有一个地方可以写。
CREATE TABLE IF NOT EXISTS interview_consent_submissions (
  id                    text PRIMARY KEY,
  org_id                text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  interview_session_id  text NOT NULL REFERENCES interview_sessions (id) ON DELETE CASCADE,
  subject_id            text NOT NULL REFERENCES interview_subjects (id) ON DELETE CASCADE,
  -- 四项同意位的逐字副本（`interview.ConsentKey` 的四个成员）。这里不重声明枚举，
  -- 只声明这四个布尔列——`I-2` 断言的是契约里的枚举成员集合，不是这几列的名字。
  record                boolean NOT NULL,
  transcript            boolean NOT NULL,
  ai_analysis            boolean NOT NULL,
  attribution            boolean NOT NULL,
  submitted_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS interview_consent_submissions_lookup_idx
  ON interview_consent_submissions (org_id, interview_session_id, subject_id, submitted_at DESC);

-- ---------------------------------------------------------------------------------------
-- RLS：与其它每张租户表同一条规则（kernel_tenant_table_audit 自动发现新表）
-- ---------------------------------------------------------------------------------------
ALTER TABLE interview_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_subjects FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS interview_subjects_tenant ON interview_subjects;
CREATE POLICY interview_subjects_tenant ON interview_subjects
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

ALTER TABLE interview_session_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_session_subjects FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS interview_session_subjects_tenant ON interview_session_subjects;
CREATE POLICY interview_session_subjects_tenant ON interview_session_subjects
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

ALTER TABLE interview_consent_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_consent_submissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS interview_consent_submissions_tenant ON interview_consent_submissions;
CREATE POLICY interview_consent_submissions_tenant ON interview_consent_submissions
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON interview_subjects FROM app_rw;
REVOKE ALL ON interview_session_subjects FROM app_rw;
REVOKE ALL ON interview_consent_submissions FROM app_rw;

GRANT SELECT, INSERT, UPDATE ON interview_subjects TO app_rw;
GRANT SELECT, INSERT ON interview_session_subjects TO app_rw;
-- append-only：**没有 UPDATE、没有 DELETE**（I-16）。
GRANT SELECT, INSERT ON interview_consent_submissions TO app_rw;

-- F22 的停用冻结。理由同 0020：编号在前的迁移不会自动扫到本迁移新建的表。
SELECT kernel_apply_org_freeze_policies();

COMMENT ON TABLE interview_subjects IS
  'F97: 访谈/观察对象。项目侧组卡（按 group_id）与访谈侧受访者名单（经 '
  'interview_session_subjects）是同一张表的两处投影，不是两份数据。状态列不落盘，'
  '派生自 interview_consent_submissions（I-19/I-20）。';
COMMENT ON TABLE interview_session_subjects IS
  'F97: 对象↔访谈场次关联，对应 domain.md InterviewSession.requiredSubjectIds 的存储形态。';
COMMENT ON TABLE interview_consent_submissions IS
  'F97: 同意书事实的唯一存放处（append-only，I-16）。Subject.consentStatus 只从这里派生，'
  '磁盘上不存在第二份同意书状态（I-20）。完整分发流程属 F86/F87。';
