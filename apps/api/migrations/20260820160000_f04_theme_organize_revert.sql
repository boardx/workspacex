-- F04（phase-11-research-insight-backend）：主题整理三动作（合并/拆分/调权）+
-- 预览守护唯一反例 + 回滚（uc-6-5 R3 step6，`packages/contracts/src/interview.ts`
-- `mergeThemes`/`splitThemes`/`adjustEvidenceWeight`）。建在 F01
-- （`20260820090000_f01_insight_write_path.sql`）已建的 `interview_insights` /
-- `interview_quotes` 之上，只做加法：新表 + 既有表新增列，不改 F01 的既有列/约束。
--
-- ## 四张东西，各答一个问题
--
-- `interview_themes` —— 主题本身。`status` 三态：`active`（可被 merge/split/引用）、
--   `merged`（被合并掉，`merged_into_theme_id` 指向去处）、`split_out`（被拆分掉，
--   同样可选地记 `merged_into_theme_id` 但拆分是一对多，去处见 `interview_theme_operations`
--   的 payload，本列此时留 NULL）。⚠ **status 不是软删除的遮羞布**：`commitMerge`/
--   `commitSplit` 的 UPDATE 语句都带 `WHERE status = 'active'`，这一条 WHERE 是本
--   feature 唯一的并发保护（E3/V12）——两个并发请求同时 UPDATE 同一行，Postgres 的行锁
--   保证只有一个的 WHERE 条件在提交时仍然成立，另一个 UPDATE 返回 0 行，调用方据此判定
--   `CONCURRENT_MODIFICATION`，不是靠客户端传一个 `expectedVersion`（契约里也确实没有
--   这个入参）。
--
-- `interview_insights.theme_id` —— 洞察归属的主题（可空：F01 遗留的洞察还没被整理进
--   任何主题）。合并/拆分动作把这一列在同一事务内批量重写，这是"洞察从旧主题挪到新
--   主题"这件事在数据层唯一的落点。
--
-- `interview_quotes.weight` / `is_counterexample` / `is_appeasement` —— 三个新列，供
--   `adjustEvidenceWeight` 和"某格子是不是反例"的守护判定使用。⚠ `weight <= 0`
--   在 `domain/interview/theme-organize.ts` 里被当作"这条引述已不再作为证据存在"——
--   这正是调权动作可能触发 `COUNTEREXAMPLE_WOULD_VANISH` 的原因：把唯一反例引述的
--   权重调到 0，等于把它从矩阵格子里抹掉。`is_counterexample`/`is_appeasement` 是
--   现场标注的既成事实（同 `domain/interview/evidence-matrix.ts` 文件头「本文件刻意
--   没有从众关系的自动识别」的既有边界），本迁移只补持久化列，不新增判定逻辑。
--
-- `interview_theme_operations` —— 合并/拆分/调权三个动作各自的回滚日志。`payload`
--   存"撤销这一次操作需要的最小事实"（各操作形状不同，见 application 层三个 commit*
--   方法头注），`revert_token` 是契约要求返回给调用方、用来兑现回滚的唯一凭证。
--   append-only 加一列 `reverted_at`（可空，首次回滚时置位）而不是删除这一行——
--   回滚本身也要留痕，且同一个 token 不能被兑现两次（`revert()` 判 `reverted_at IS NULL`）。
--
-- 可独立重放：全程 IF NOT EXISTS / ADD COLUMN IF NOT EXISTS。

CREATE TABLE IF NOT EXISTS interview_themes (
  id                    text PRIMARY KEY,
  org_id                text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  label                 text NOT NULL CHECK (length(label) > 0),
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'merged', 'split_out')),
  merged_into_theme_id  text NULL REFERENCES interview_themes (id),
  created_by            text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS interview_themes_org_status_idx
  ON interview_themes (org_id, status);

ALTER TABLE interview_themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_themes FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS interview_themes_tenant ON interview_themes;
CREATE POLICY interview_themes_tenant ON interview_themes
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

GRANT SELECT, INSERT, UPDATE ON interview_themes TO app_rw;

ALTER TABLE interview_insights
  ADD COLUMN IF NOT EXISTS theme_id text NULL REFERENCES interview_themes (id);

CREATE INDEX IF NOT EXISTS interview_insights_theme_idx
  ON interview_insights (org_id, theme_id);

ALTER TABLE interview_quotes
  ADD COLUMN IF NOT EXISTS weight numeric NOT NULL DEFAULT 1 CHECK (weight >= 0),
  ADD COLUMN IF NOT EXISTS is_counterexample boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_appeasement boolean NOT NULL DEFAULT false;

-- F01 只 GRANT 了 SELECT, INSERT（append-only）；`adjustEvidenceWeight` 需要改 `weight`，
-- 只加这一列的写权限所需的动词，不重新开放对其余 append-only 列的 UPDATE 语义
-- （应用层 SQL 自己只 SET weight/updated_at 之类，列级约束不足以在 GRANT 层面单独锁定
-- 到某一列，因此这里如实 GRANT 表级 UPDATE，纪律落在应用层 SQL 语句本身只碰 weight 列）。
GRANT UPDATE ON interview_quotes TO app_rw;

CREATE TABLE IF NOT EXISTS interview_theme_operations (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('merge', 'split', 'adjust_weight')),
  revert_token  text NOT NULL UNIQUE,
  -- 撤销这一次操作所需的最小事实（形状因 kind 而异，见各 commit* 方法头注）。
  payload       jsonb NOT NULL,
  reverted_at   timestamptz NULL,
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS interview_theme_operations_org_idx
  ON interview_theme_operations (org_id, created_at DESC);

ALTER TABLE interview_theme_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_theme_operations FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS interview_theme_operations_tenant ON interview_theme_operations;
CREATE POLICY interview_theme_operations_tenant ON interview_theme_operations
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

GRANT SELECT, INSERT, UPDATE ON interview_theme_operations TO app_rw;

SELECT kernel_apply_org_freeze_policies();

COMMENT ON TABLE interview_themes IS
  'F04: 主题整理的主题本身。status=active 之外的行是合并/拆分留下的历史行,不可再被引用;'
  '并发保护落在 commitMerge/commitSplit 的 UPDATE ... WHERE status=''active'' 上。';
COMMENT ON TABLE interview_theme_operations IS
  'F04: 合并/拆分/调权三动作各自的回滚日志。revert_token 是契约返回给调用方的唯一凭证,'
  'reverted_at 非空即已兑现,不可重复回滚。';
