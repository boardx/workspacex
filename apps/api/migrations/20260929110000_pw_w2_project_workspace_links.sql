-- #4615 W2（PROP-PROJECT-WORKSPACE-001 §3.2，2026-09-29 人类裁决）：项目泛化为通用工作空间——挂载表装下所有模块。
--
-- 四处闭集 CHECK 跟着契约扩（契约已在基线分支落形状；CHECK 只是数据库那一层的兜底，成员与契约逐字一致）：
--   1. `project_resource_links.kind`：survey / guided_research / personal_transcription（已有）
--      + interview / whiteboard / design（契约 `ProjectLinkableResourceKind`）。
--      访谈此前只按 `interview_sessions.project_id` 归属；从此也可以经链接表挂载（`project_id` 列保留，
--      由 `pg-project-resource-repository.ts` 在挂 / 解挂时同步，见那里的文件头）。
--      白板（`whiteboards`）与设计（`design_projects`）各自的表没有 `project_id`，也不给它们加——
--      同 B2-S1 的理由：它们是个人聚合，项目归属记成链接表里的一条独立事实。
--   2. `project_evidence.source_kind`：+ whiteboard_note（契约 `ProjectEvidenceSourceKind`；一张便签 / 文本块一条）。
--   3. `claim_project_evidence.source_kind`：同上（结论 ↔ 证据单元的冗余来源列）。
--   4. `project_ai_settings.allowed_sources`：+ whiteboard（契约 `ProjectAiSourceKind`；whiteboard_note → whiteboard）。
--
-- 不建新表（因此无需再调 kernel_apply_org_freeze_policies / kernel_apply_project_archive_policies：
-- 四张表各自的迁移在首次 apply 时已经装上，本迁移不改它们的 RLS / 策略）。
-- 可重放：每个约束 DROP IF EXISTS 再 ADD（约束名是 PG 对列内联 CHECK 的默认名 `<table>_<column>_check`，
-- 首次 apply 时删掉的正是原迁移建的那一条；重放时删掉的是本迁移上一次加的那一条）。

ALTER TABLE project_resource_links DROP CONSTRAINT IF EXISTS project_resource_links_kind_check;
ALTER TABLE project_resource_links ADD CONSTRAINT project_resource_links_kind_check
  CHECK (kind IN ('survey', 'guided_research', 'personal_transcription', 'interview', 'whiteboard', 'design'));

ALTER TABLE project_evidence DROP CONSTRAINT IF EXISTS project_evidence_source_kind_check;
ALTER TABLE project_evidence ADD CONSTRAINT project_evidence_source_kind_check
  CHECK (source_kind IN ('chat_message', 'attachment', 'survey_response', 'interview_segment', 'transcript_segment',
                         'research_source', 'whiteboard_note'));

ALTER TABLE claim_project_evidence DROP CONSTRAINT IF EXISTS claim_project_evidence_source_kind_check;
ALTER TABLE claim_project_evidence ADD CONSTRAINT claim_project_evidence_source_kind_check
  CHECK (source_kind IN ('chat_message', 'attachment', 'survey_response', 'interview_segment', 'transcript_segment',
                         'research_source', 'whiteboard_note'));

ALTER TABLE project_ai_settings DROP CONSTRAINT IF EXISTS project_ai_settings_allowed_sources_check;
ALTER TABLE project_ai_settings ADD CONSTRAINT project_ai_settings_allowed_sources_check
  CHECK (allowed_sources <@ ARRAY['chat', 'whiteboard', 'transcript', 'survey', 'interview', 'research']::text[]);

-- 白板 → 项目的反查（白板访问判定每次都按 (org_id, kind='whiteboard', resource_id) 读一次；主键已覆盖这个前缀，
-- 不另建索引）。

COMMENT ON TABLE project_resource_links IS
  '#4425 / #4615：项目资源挂载层。kind ∈ survey / guided_research / personal_transcription / interview / whiteboard / design；'
  '主键 (org_id, kind, resource_id)：一个资源同一时刻只挂一个项目。挂在项目上的白板对项目成员按 resolveProjectLayer 开放'
  '（与白板自己的成员表取并集）。';
