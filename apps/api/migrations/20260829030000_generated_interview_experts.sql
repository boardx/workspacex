-- Generated interview experts are per-interview snapshots, not organization Agent definitions.
-- Catalog experts added manually still carry real Agent ids, but generated candidates must not
-- require matching rows in digital_expert_profiles / agent_versions.
ALTER TABLE digital_interview_expert_candidates
  DROP CONSTRAINT IF EXISTS digital_interview_expert_candidates_org_id_expert_id_fkey,
  DROP CONSTRAINT IF EXISTS digital_interview_expert_candidates_org_id_agent_version_agent_definition_id_fkey,
  DROP CONSTRAINT IF EXISTS digital_interview_expert_cand_org_id_agent_version_agent_d_fkey;

ALTER TABLE digital_interview_expert_snapshots
  DROP CONSTRAINT IF EXISTS digital_interview_expert_snapshots_org_id_expert_id_fkey,
  DROP CONSTRAINT IF EXISTS digital_interview_expert_snapshots_org_id_agent_version_agent_definition_id_fkey,
  DROP CONSTRAINT IF EXISTS digital_interview_expert_snap_org_id_agent_version_agent_def_fkey,
  DROP CONSTRAINT IF EXISTS digital_interview_expert_snap_org_id_agent_version_agent_d_fkey;

ALTER TABLE digital_interview_question_candidates
  DROP CONSTRAINT IF EXISTS digital_interview_question_candidates_org_id_expert_id_fkey;

ALTER TABLE digital_interview_questions
  DROP CONSTRAINT IF EXISTS digital_interview_questions_org_id_expert_id_fkey;
