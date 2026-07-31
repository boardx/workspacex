-- 0020 F80: 访谈范围模型 —— `project_id` 可空 + 两种权限投影 + 服务端过滤
-- (uc-6-0 R3, contracts/interview/domain.md I-31, coverage uc-6-0 R12 V1 / V2)
--
-- ## 为什么 `project_id` 必须可空，而且必须现在就可空
--
-- domain.md 把 `InterviewSession` 写成**一等对象，不依赖项目**：
-- 「`projectId: ProjectId | null` —— **可空**。「不属于任何项目」是一等范围，不是兜底桶」。
-- feature_list 的 notes 更直白：若做成 NOT NULL，6.1/6.2/6.5/6.7 全返工。
-- 所以这张表的第一件事就是把这一列建成 NULL 的，并把「无项目」当成正常路径而不是异常。
--
-- ## 两种权限投影
--
-- 可见性**不是一条规则**，是两条，按 `project_id` 是否为空分岔（usecases.md `getInterview` 的 pre）：
--
--   project_id IS NULL      ⇒ 创建者 + 显式协作者。**不因为没有项目就全组织可见**（I-31）
--   project_id IS NOT NULL  ⇒ 创建者 + 显式协作者 + 该项目成员
--
-- 注意第二条是**并集**而不是替换：一个项目内访谈的创建者调离项目后仍是创建者。
-- 也注意第一条**没有**「组织管理员」这一项 —— R5 明写「项目负责人不因职位自动获得
-- 跨项目/无项目访谈的读权」。
--
-- ## 过滤为什么在 SQL 里
--
-- V2 的验收线索是「列表不返回再前端过滤」。一个「先 SELECT * 再在 JS 里 filter」的实现，
-- 单测全绿、界面也对，只有抓包能看见越权数据已经过了网线。所以可见性谓词写在这张表的
-- 查询里（见 `pg-interview-scope-repository.ts` 的 `VISIBILITY_PREDICATE`），
-- 而 use case 只是把行原样往外递。
--
-- ## 这里**没有**什么
--
-- 没有 `status`、没有 `applied_template_version_id`、没有挂载关系表。
-- `InterviewSession.status` 的取值集合是 domain.md 自己标的 [待定 D-2]，
-- 建一列取值不明的枚举比不建更糟；挂载（`StepAttachment`）是 F81 的活。
-- 本迁移只建「范围 + 可见性」这一件事需要的最小结构。
--
-- 可独立重放：全程 IF NOT EXISTS / DROP-then-CREATE，因为 migrate:check 会忽略版本表强制重放。

CREATE TABLE IF NOT EXISTS interview_sessions (
  id                  text PRIMARY KEY,
  org_id              text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- ⚠ 本迁移存在的理由就是这一个 NULL。别「顺手补上 NOT NULL」。
  --
  -- ON DELETE SET NULL 而不是 CASCADE：项目没了，访谈**还在**，只是回到「不属于任何项目」。
  -- 这与 uc-6-0/A3「解除挂载后回到无项目且产出仍在」是同一条语义的两个入口。
  -- CASCADE 会让删一个项目静默删掉一批访谈记录 —— 那是数据损坏，不是清理。
  project_id          text NULL REFERENCES projects (id) ON DELETE SET NULL,
  -- ⚠ 无外键，**故意的**。research project 在 phase-01 没有表，也没有成员模型
  -- （domain.md [待定 D-1]：一场访谈能否同时归属研究项目与业务项目，一个外键还是两个）。
  -- 编一张 research_projects 表出来会让契约看起来覆盖了那件事，而它是空的。
  research_project_id text NULL,
  -- 封闭二值。`interview.InterviewSourceKind` 的逐字副本，且**不留作副本**：
  -- 测试从 pg_catalog 读出这条 CHECK 并与契约枚举逐成员比对（0005/0006/0008 用的手法）。
  source_kind         text NOT NULL CHECK (source_kind IN ('human', 'virtual')),
  title               text NOT NULL CHECK (length(title) > 0),
  -- 两种投影里都出现的那一项。永远非空：一场没有创建者的访谈，第一条投影就退化成「谁都看不见」。
  created_by          text NOT NULL,
  tags                text[] NOT NULL DEFAULT '{}',
  archived            boolean NOT NULL DEFAULT false,
  when_at             timestamptz NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- 约束回填。`CREATE TABLE IF NOT EXISTS` 打在已存在的表上是**静默 no-op**：
-- CHECK 一条都不会补上，而文件照样报成功。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_sessions_source_kind_check') THEN
    ALTER TABLE interview_sessions
      ADD CONSTRAINT interview_sessions_source_kind_check
      CHECK (source_kind IN ('human', 'virtual'));
  END IF;
END
$$;

-- 「不属于任何项目」是一等范围，所以它要有自己的索引 —— 部分索引，因为它是被**单独**查的档位。
CREATE INDEX IF NOT EXISTS interview_sessions_no_project_idx
  ON interview_sessions (org_id, created_by, created_at DESC)
  WHERE project_id IS NULL;
CREATE INDEX IF NOT EXISTS interview_sessions_project_idx
  ON interview_sessions (org_id, project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS interview_sessions_research_idx
  ON interview_sessions (org_id, research_project_id, created_at DESC);

-- ---------------------------------------------------------------------------------------
-- 显式协作者 —— 第一种投影里唯一的「创建者以外」的来源
-- ---------------------------------------------------------------------------------------
-- 是一张**独立的表**而不是 `interview_sessions.collaborator_ids text[]`：
-- 数组列没法加外键、没法索引成 join、也没法记「谁在什么时候把人加进来的」，
-- 而「显式」这两个字的全部意义就在于它是一次可追溯的授予动作。
CREATE TABLE IF NOT EXISTS interview_collaborators (
  interview_id text NOT NULL REFERENCES interview_sessions (id) ON DELETE CASCADE,
  user_id      text NOT NULL,
  org_id       text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  added_by     text NOT NULL,
  added_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (interview_id, user_id)
);

CREATE INDEX IF NOT EXISTS interview_collaborators_user_idx
  ON interview_collaborators (org_id, user_id);

-- ---------------------------------------------------------------------------------------
-- RLS：与其它每张租户表同一条规则
-- ---------------------------------------------------------------------------------------
-- kernel_tenant_table_audit()（0004）在这两张表存在的那一刻就从 catalog 里发现它们，
-- 所以这一段一旦被删掉，verify-rls.sh 与 rls-cross-tenant-zero-leak 会红。门控不是被告知新表的，它自己找。
--
-- ⚠ RLS 管的是**租户**这一层，管不了「同一组织内谁能看哪一场」。
-- 那是本 feature 的两种投影，写在查询谓词里。两道门是两件事，谁也替不了谁。
ALTER TABLE interview_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS interview_sessions_tenant ON interview_sessions;
CREATE POLICY interview_sessions_tenant ON interview_sessions
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

ALTER TABLE interview_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_collaborators FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS interview_collaborators_tenant ON interview_collaborators;
CREATE POLICY interview_collaborators_tenant ON interview_collaborators
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON interview_sessions FROM app_rw;
REVOKE ALL ON interview_collaborators FROM app_rw;

-- F80 只读范围与可见性；写入路径（新建向导）是 F84。这里给出 INSERT 是因为
-- 没有 INSERT 就没有任何东西能造出一场访谈来被读 —— 包括门控自己的 fixture，
-- 而 fixture 若走 owner 角色写入，就绕过了上面那条 WITH CHECK，
-- 于是整套断言建立在生产永远写不出来的数据上。
-- 没有 DELETE：删一场访谈在 uc-6-0 里不存在（解除挂载 ≠ 删除）。
GRANT SELECT, INSERT, UPDATE ON interview_sessions TO app_rw;
GRANT SELECT, INSERT ON interview_collaborators TO app_rw;

-- F22 的停用冻结（三条 RESTRICTIVE 策略：INSERT / UPDATE / DELETE）。
--
-- ⚠ 必须显式调用一次，**不能**指望 0014 自己扫到这两张表：0014 的编号在前，
--   首次跑迁移时它们还不存在。少了这一行的表现极具欺骗性 ——
--   新库上这两张表**没有**冻结，而 F22 的断言仍然全绿（它们测的是当时已存在的那些表）。
--   本迁移正是这样漏掉过一次，由 `tests/auth/org-disabled-readonly.test.ts` 的
--   catalog 推导断言在 CI 上抓到：「新表默认不在冻结范围内 —— 这条断言就是那道警报」。
--   规则本身仍只声明在 0014 —— 在这里抄一遍三条 CREATE POLICY 才是第二份事实源。
--
-- ⚠ 与上面的 GRANT 是**两件事**，别因为「本表没给运行时角色 DELETE 权限」就以为
--   DELETE 那条冻结策略是多余的：GRANT 管的是角色权限，策略管的是行级准入，
--   任何一方将来放开，另一方都得已经在位。
SELECT kernel_apply_org_freeze_policies();

COMMENT ON TABLE interview_sessions IS
  'F80: 访谈场次。project_id 可空 —— 「不属于任何项目」是一等范围。可见性有两种投影：'
  '无项目 = 创建者 + 显式协作者；有项目 = 再并上该项目成员。过滤在 SQL 里，不返回全量再前端过滤。';
COMMENT ON TABLE interview_collaborators IS
  'F80: 显式协作者。project_id IS NULL 的访谈唯一的「创建者以外」的可见性来源（I-31）。';
