-- Rebuildable scheduling hint only. Original purchase anchor remains the grant authority.
ALTER TABLE billing_personal_terms ADD COLUMN IF NOT EXISTS next_check_at timestamptz DEFAULT now();
CREATE INDEX IF NOT EXISTS billing_personal_terms_due ON billing_personal_terms(next_check_at,user_id) WHERE next_check_at IS NOT NULL;
GRANT UPDATE(next_check_at) ON billing_personal_terms TO app_rw;
COMMENT ON TABLE billing_personal_terms IS 'kernel-no-tenant-data: owner-global verified paid-term metadata. Payment facts are immutable to app_rw; next_check_at is a rebuildable scheduler hint, never authorization to grant. Public access scopes the authenticated user. No wallet balance or user content.';
