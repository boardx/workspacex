-- A copied recurring URL may be paid during cutover. Preserve both payment identities
-- for explicit financial recovery instead of granting overlapping periods or retrying a new charge.
CREATE TABLE IF NOT EXISTS billing_payment_conflicts (
 conflict_key text PRIMARY KEY CHECK(length(conflict_key)>0),
 user_id text NOT NULL CHECK(length(user_id)>0),
 provider_ref text NOT NULL,
 other_ref text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz
);
COMMENT ON TABLE billing_payment_conflicts IS 'kernel-no-tenant-data: owner-global immutable payment overlap evidence; verified payment stores append, app_rw cannot update or delete. Resolution is an explicit operator action, never an automatic refund or extra grant. Trusted owner scopes public access.';
REVOKE ALL ON billing_payment_conflicts FROM app_rw;
GRANT SELECT,INSERT ON billing_payment_conflicts TO app_rw;
