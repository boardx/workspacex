-- A source version can have multiple independently verified rendered layouts.
-- Preserve existing bindings; no artifact/source/tenant privilege is broadened.
ALTER TABLE whiteboard_artifact_layout_bindings
  DROP CONSTRAINT whiteboard_artifact_layout_bindings_pkey;
ALTER TABLE whiteboard_artifact_layout_bindings
  ADD PRIMARY KEY (org_id, artifact_id, artifact_version_id, layout_digest);
