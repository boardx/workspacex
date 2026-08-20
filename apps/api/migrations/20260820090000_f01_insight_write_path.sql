-- F01（phase-06-research-insight-backend）：访谈回流成洞察的写路径真实持久化
-- （uc-6-5 R3 step1-3，`packages/contracts/src/interview.ts` extractQuotes /
-- generateCandidateInsights / confirmInsight，`Insight`/`Quote`）。
--
-- ## 三张表，各答一个问题
--
-- `interview_quotes`     —— 人工抽引述（`extractQuotes`）落的行。⚠ **必须比候选/洞察更
--   持久**：E1「归纳失败已抽引述保留、不产出半截洞察」要求即便下一步的候选生成整个
--   失败，这里的行也原样还在——所以它是独立一张表、独立一次 INSERT，不是候选生成
--   过程中的临时状态。
--
-- `interview_insight_source_snapshots` —— 入库时固化的来源快照（I-29/R7「入库时必须
--   固化来源快照，日后原始转写被编辑不影响已入库证据文本」）。`quotes` 存的是**那一刻**
--   引述文本的冻结副本（jsonb 数组），不是对 `interview_quotes` 行的引用——引用会让
--   "冻结" 名不副实：`interview_quotes.text` 未来若被其它路径编辑，冻结应该纹丝不动。
--   append-only（不给 UPDATE/DELETE）：快照的全部价值就是它不会变。
--
-- `interview_insights`   —— 确认入库的洞察本身（`confirmInsight` 的落点）。
--   `pinned_source_snapshot_id` 指向上面那张表的行，`evidence_quote_ids` 是原始引述 id
--   数组（供 UI 回链到「哪些引述」，快照文本是防篡改的第二份，两者服务不同目的，
--   不是同一份数据的两处声明）。`excluded_subject_ids` 把这条洞察诞生那次
--   `generateCandidateInsights` 调用的排除名单一并留痕（R3 step2「排除名单写入留痕」），
--   不是本表自己新发明的一个字段——候选阶段算出来的名单，入库时原样带过来。
--
-- 三张表都没有 `interview_id → interview_sessions` 外键：`interview_sessions` 由 F80
-- （`0020-f80-interview-scope.sql`）建，本迁移不重复它的存在性假设，只按 `org_id` 做
-- 租户隔离（与 `interview_subjects` 对 `group_id` 外键可空、`interview_id` 目前同样
-- 不设外键的既有先例一致——F01 notes 明确「本 feature 只补持久化，不重写既有域
-- 表结构假设」）。
--
-- 可独立重放：全程 IF NOT EXISTS。

CREATE TABLE IF NOT EXISTS interview_quotes (
  id           text PRIMARY KEY,
  org_id       text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  interview_id text NOT NULL,
  segment_id   text NOT NULL,
  -- 可空：不是每个片段都能解析出说话人（同 F93 `segment_text.speaker_subject_id` 的
  -- nullable 约定，这里冻结的是抽取那一刻已解析出的值）。
  subject_id   text NULL,
  -- 抽取那一刻冻结的来源判定（human/virtual）——下游 candidate-insight.ts 的
  -- `buildCandidateInsight` 靠它判定候选整条是否算 virtual（C_ITV_6 的保守默认）。
  source_kind  text NOT NULL DEFAULT 'human' CHECK (source_kind IN ('human', 'virtual')),
  text         text NOT NULL CHECK (length(text) > 0),
  rq_id        text NULL,
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS interview_quotes_interview_idx
  ON interview_quotes (org_id, interview_id, created_at DESC);
CREATE INDEX IF NOT EXISTS interview_quotes_segment_idx
  ON interview_quotes (org_id, segment_id);

ALTER TABLE interview_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_quotes FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS interview_quotes_tenant ON interview_quotes;
CREATE POLICY interview_quotes_tenant ON interview_quotes
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

-- append-only：抽引述不可编辑/删除，与转写留可见缺口（E8）同一立场——保留原始事实。
REVOKE ALL ON interview_quotes FROM app_rw;
GRANT SELECT, INSERT ON interview_quotes TO app_rw;

CREATE TABLE IF NOT EXISTS interview_insight_source_snapshots (
  id         text PRIMARY KEY,
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- 冻结副本：[{quoteId, segmentId, subjectId, sourceKind, text, rqId}, ...]。
  -- ⚠ 不是引用——见文件头「为什么是副本不是引用」。
  quotes     jsonb NOT NULL CHECK (jsonb_typeof(quotes) = 'array' AND jsonb_array_length(quotes) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE interview_insight_source_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_insight_source_snapshots FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS interview_insight_source_snapshots_tenant ON interview_insight_source_snapshots;
CREATE POLICY interview_insight_source_snapshots_tenant ON interview_insight_source_snapshots
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

-- 不可变：**没有 UPDATE、没有 DELETE**（R7「入库时固化，日后不受影响」在权限层的落点，
-- 不只是应用代码承诺不改）。
REVOKE ALL ON interview_insight_source_snapshots FROM app_rw;
GRANT SELECT, INSERT ON interview_insight_source_snapshots TO app_rw;

CREATE TABLE IF NOT EXISTS interview_insights (
  id                        text PRIMARY KEY,
  org_id                    text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  interview_id              text NOT NULL,
  text                      text NOT NULL CHECK (length(text) > 0),
  source_kind               text NOT NULL CHECK (source_kind IN ('human', 'virtual')),
  -- 候选恒不标强（candidate-insight.ts 的不变量②）；标强是 markStrongInsight（F03）
  -- 单独的人工确认动作，此列在 F01 恒插 false，UPDATE 授权先开给 F03 用。
  strong                    boolean NOT NULL DEFAULT false,
  -- 至少 1 条证据（I-29），DB 层再钉一次，不止应用层 checkConfirmable 一处判定。
  evidence_quote_ids        text[] NOT NULL CHECK (array_length(evidence_quote_ids, 1) >= 1),
  pinned_source_snapshot_id text NOT NULL REFERENCES interview_insight_source_snapshots (id),
  excluded_subject_ids      text[] NOT NULL DEFAULT '{}',
  created_by                text NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS interview_insights_interview_idx
  ON interview_insights (org_id, interview_id, created_at DESC);

ALTER TABLE interview_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_insights FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS interview_insights_tenant ON interview_insights;
CREATE POLICY interview_insights_tenant ON interview_insights
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON interview_insights FROM app_rw;
-- UPDATE 授权先开给 F03（markStrongInsight）/F04（主题整理）——F01 本身只 INSERT，
-- 但表一旦建好，后续 feature 不该再为它补一次 GRANT 迁移。
GRANT SELECT, INSERT, UPDATE ON interview_insights TO app_rw;

SELECT kernel_apply_org_freeze_policies();

COMMENT ON TABLE interview_quotes IS
  'F01: 人工抽引述（extractQuotes）落的行。append-only；即便下一步候选生成失败，这里的'
  '行原样保留（E1 事务性）。';
COMMENT ON TABLE interview_insight_source_snapshots IS
  'F01: confirmInsight 入库时固化的来源快照（不可变，I-29/R7）。存冻结副本，不是引用。';
COMMENT ON TABLE interview_insights IS
  'F01: 确认入库的洞察。pinned_source_snapshot_id 指向不可变快照；excluded_subject_ids '
  '把生成那次调用的排除名单一并留痕。';
