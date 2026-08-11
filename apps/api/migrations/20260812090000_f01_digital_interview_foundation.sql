-- Phase 04 F01：数字专家访谈复用 interview_sessions 身份、范围和 RLS，
-- 只在同一行增加工作流状态与可恢复字段，不创建第二套访谈对象。

ALTER TABLE interview_sessions
  ADD COLUMN IF NOT EXISTS topic text NULL,
  ADD COLUMN IF NOT EXISTS digital_status text NULL,
  ADD COLUMN IF NOT EXISTS source_quick_interview_id text NULL REFERENCES interview_sessions (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS selected_expert_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS report_id text NULL,
  ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_sessions_digital_status_check') THEN
    ALTER TABLE interview_sessions
      ADD CONSTRAINT interview_sessions_digital_status_check
      CHECK (digital_status IS NULL OR digital_status IN (
        'draft', 'topic_pending', 'experts_pending', 'questions_pending',
        'running', 'report_pending', 'completed', 'failed'
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_sessions_digital_draft_fields_check') THEN
    ALTER TABLE interview_sessions
      ADD CONSTRAINT interview_sessions_digital_draft_fields_check
      CHECK (
        digital_status IS NULL OR (
          source_kind = 'virtual'
          AND topic IS NOT NULL AND length(btrim(topic)) > 0
          AND cardinality(tags) > 0
          AND version > 0
        )
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS interview_sessions_digital_history_idx
  ON interview_sessions (org_id, digital_status, updated_at DESC)
  WHERE digital_status IS NOT NULL;

COMMENT ON COLUMN interview_sessions.digital_status IS
  'Phase 04 F01：数字专家访谈八态唯一事实源；卡片、详情、步骤与主操作均从此字段投影。';

SELECT kernel_apply_org_freeze_policies();
