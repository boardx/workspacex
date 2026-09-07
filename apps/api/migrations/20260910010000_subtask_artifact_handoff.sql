-- WX-T042 governed file handoff. The child row owns its immutable execution snapshot
-- and the stable artifact references; bytes remain in the existing object store.
ALTER TABLE subtask_runs ADD COLUMN IF NOT EXISTS output_policy jsonb;
ALTER TABLE subtask_runs ADD COLUMN IF NOT EXISTS agent_version_id text;
ALTER TABLE subtask_runs ADD COLUMN IF NOT EXISTS skill_version_ids jsonb;
ALTER TABLE subtask_runs ADD COLUMN IF NOT EXISTS model_provider text;
ALTER TABLE subtask_runs ADD COLUMN IF NOT EXISTS model_id text;
ALTER TABLE subtask_runs ADD COLUMN IF NOT EXISTS artifact_refs jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE subtask_runs ADD COLUMN IF NOT EXISTS output_manifest jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE subtask_runs c SET
  agent_version_id=r.agent_version_id,
  skill_version_ids=r.skill_version_ids,
  model_provider=r.model_provider,
  model_id=r.model_id
FROM agent_runs r WHERE r.org_id=c.org_id AND r.id=c.parent_run_id
  AND c.agent_version_id IS NULL;

ALTER TABLE subtask_runs ALTER COLUMN agent_version_id SET NOT NULL;
ALTER TABLE subtask_runs ALTER COLUMN skill_version_ids SET NOT NULL;
ALTER TABLE subtask_runs ALTER COLUMN model_provider SET NOT NULL;
ALTER TABLE subtask_runs ALTER COLUMN model_id SET NOT NULL;
ALTER TABLE subtask_runs DROP CONSTRAINT IF EXISTS subtask_output_policy_shape;
ALTER TABLE subtask_runs ADD CONSTRAINT subtask_output_policy_shape CHECK (
  output_policy IS NULL OR
  (jsonb_typeof(output_policy)='object' AND jsonb_typeof(output_policy->'mediaTypes')='array'
   AND jsonb_array_length(output_policy->'mediaTypes') BETWEEN 1 AND 12
   AND (output_policy->>'maxFiles')::integer BETWEEN 1 AND 20
   AND (output_policy->>'maxTotalBytes')::bigint BETWEEN 1 AND 67108864)
);
ALTER TABLE subtask_runs DROP CONSTRAINT IF EXISTS subtask_artifact_refs_shape;
ALTER TABLE subtask_runs ADD CONSTRAINT subtask_artifact_refs_shape CHECK (jsonb_typeof(artifact_refs)='array');
ALTER TABLE subtask_runs DROP CONSTRAINT IF EXISTS subtask_output_manifest_shape;
ALTER TABLE subtask_runs ADD CONSTRAINT subtask_output_manifest_shape CHECK (jsonb_typeof(output_manifest)='array');
SELECT kernel_apply_org_freeze_policies();
