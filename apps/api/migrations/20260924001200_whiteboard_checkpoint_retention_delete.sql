-- Retention maintenance runs through the tenant-scoped app role. Replace the
-- broad tenant policy with operation-specific policies so DELETE itself can
-- affect only expired active metadata. Restore receipts remain immutable.
DROP POLICY IF EXISTS whiteboard_checkpoints_tenant ON whiteboard_checkpoints;
DROP POLICY IF EXISTS whiteboard_checkpoints_tenant_select ON whiteboard_checkpoints;
DROP POLICY IF EXISTS whiteboard_checkpoints_tenant_insert ON whiteboard_checkpoints;
DROP POLICY IF EXISTS whiteboard_checkpoints_tenant_retention_delete ON whiteboard_checkpoints;
CREATE POLICY whiteboard_checkpoints_tenant_select ON whiteboard_checkpoints
  FOR SELECT USING (org_id=current_setting('app.current_org',true));
CREATE POLICY whiteboard_checkpoints_tenant_insert ON whiteboard_checkpoints
  FOR INSERT WITH CHECK (org_id=current_setting('app.current_org',true));
CREATE POLICY whiteboard_checkpoints_tenant_retention_delete ON whiteboard_checkpoints
  FOR DELETE USING (
    org_id=current_setting('app.current_org',true)
    AND retention_state='active'
    AND retention_until<=clock_timestamp()
  );
GRANT DELETE ON whiteboard_checkpoints TO app_rw;
REVOKE DELETE ON whiteboard_checkpoint_restores FROM app_rw;
