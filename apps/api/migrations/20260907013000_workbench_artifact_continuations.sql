-- Versions reference the SAME immutable bytes as the assistant attachment.
CREATE UNIQUE INDEX IF NOT EXISTS chat_message_attachments_org_id_id_artifact_idx ON chat_message_attachments(org_id,id);
ALTER TABLE agent_artifact_versions ADD COLUMN attachment_id text;
ALTER TABLE agent_artifact_versions ADD CONSTRAINT agent_artifact_version_attachment_tenant_fk
  FOREIGN KEY(org_id,attachment_id) REFERENCES chat_message_attachments(org_id,id);
ALTER TABLE agent_artifact_versions ADD COLUMN based_on_version integer;
CREATE UNIQUE INDEX agent_artifact_versions_attachment ON agent_artifact_versions(attachment_id) WHERE attachment_id IS NOT NULL;

CREATE TABLE agent_run_artifact_context (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  artifact_id text NOT NULL REFERENCES agent_artifacts(id) ON DELETE CASCADE,
  based_on_version integer NOT NULL CHECK (based_on_version > 0),
  PRIMARY KEY(org_id,run_id),
  FOREIGN KEY(org_id,run_id) REFERENCES agent_runs(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY(org_id,artifact_id,based_on_version) REFERENCES agent_artifact_versions(org_id,artifact_id,version)
);
ALTER TABLE agent_run_artifact_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_run_artifact_context FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_run_artifact_context_tenant ON agent_run_artifact_context
  USING (org_id=current_setting('app.current_org',true))
  WITH CHECK (org_id=current_setting('app.current_org',true));
GRANT SELECT,INSERT ON agent_run_artifact_context TO app_rw;
SELECT kernel_apply_org_freeze_policies();

-- Existing successful assistant outputs become version metadata over the existing
-- attachment object, without copying bytes or manufacturing a producing step.
INSERT INTO agent_artifacts(id,org_id,thread_id,name,kind)
SELECT 'agent-artifact-'||a.id,a.org_id,a.thread_id,a.filename,
  CASE lower(regexp_replace(a.filename,'^.*\.','')) WHEN 'pdf' THEN 'pdf' WHEN 'docx' THEN 'docx' WHEN 'png' THEN 'png' ELSE 'other' END
FROM chat_message_attachments a
JOIN chat_messages m ON m.org_id=a.org_id AND m.id=a.message_id AND m.author_kind='agent'
JOIN agent_runs r ON r.org_id=m.org_id AND r.id=m.agent_run_id AND r.status='succeeded'
WHERE EXISTS (SELECT 1 FROM agent_run_steps s WHERE s.org_id=r.org_id AND s.run_id=r.id)
ON CONFLICT DO NOTHING;
INSERT INTO agent_artifact_versions(id,org_id,artifact_id,version,produced_by_run_id,produced_by_step_id,change_note,storage_key,size_bytes,attachment_id)
SELECT 'agent-artifact-'||a.id||'-v1',a.org_id,'agent-artifact-'||a.id,1,r.id,s.id,input.body,a.storage_ref,a.bytes,a.id
FROM chat_message_attachments a
JOIN chat_messages m ON m.org_id=a.org_id AND m.id=a.message_id AND m.author_kind='agent'
JOIN agent_runs r ON r.org_id=m.org_id AND r.id=m.agent_run_id AND r.status='succeeded'
JOIN chat_messages input ON input.org_id=r.org_id AND input.id=r.input_message_id
JOIN LATERAL (SELECT id FROM agent_run_steps WHERE org_id=r.org_id AND run_id=r.id ORDER BY seq DESC LIMIT 1) s ON true
ON CONFLICT DO NOTHING;
