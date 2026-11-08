-- Retire organization-only lead/compliance assignments. Project roles and historical
-- audit/token claims remain unchanged. Invitation acceptance reads authoritative rows,
-- so normalize grants as well as existing memberships before enforcing the write fence.
-- Standard migration runner uses its migration connection, never an application request.
UPDATE org_memberships SET org_role = 'consultant' WHERE org_role IN ('lead', 'compliance');
UPDATE org_invites SET org_role = 'consultant' WHERE org_role IN ('lead', 'compliance');
UPDATE org_invite_links SET org_role = 'consultant' WHERE org_role IN ('lead', 'compliance');

ALTER TABLE org_memberships DROP CONSTRAINT IF EXISTS org_memberships_active_org_role;
ALTER TABLE org_memberships ADD CONSTRAINT org_memberships_active_org_role CHECK (org_role IN ('admin', 'consultant'));
ALTER TABLE org_invites DROP CONSTRAINT IF EXISTS org_invites_active_org_role;
ALTER TABLE org_invites ADD CONSTRAINT org_invites_active_org_role CHECK (org_role IN ('admin', 'consultant'));
ALTER TABLE org_invite_links DROP CONSTRAINT IF EXISTS org_invite_links_active_org_role;
ALTER TABLE org_invite_links ADD CONSTRAINT org_invite_links_active_org_role CHECK (org_role IN ('admin', 'consultant'));
