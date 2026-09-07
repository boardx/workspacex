-- Ownership and delivery receipts only. Timing/cron/jobs remain in official pg-boss.
CREATE TABLE IF NOT EXISTS standard_schedules (
 id uuid NOT NULL,
 org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id text NOT NULL,
 thread_id text NOT NULL,
 agent_id text NOT NULL,
 instruction text NOT NULL CHECK(length(instruction)<=8000),
 idempotency_key uuid NOT NULL,
 args_digest text NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK(status IN('active','cancelled','completed','failed')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 last_occurrence_id uuid NULL,
 last_run_id text NULL,
 failure_code text NULL CHECK(failure_code IN('authorization_revoked','delivery_rejected')),
 notification_pending boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,id),
 UNIQUE(org_id,user_id,idempotency_key),
 FOREIGN KEY(org_id,thread_id) REFERENCES chat_threads(org_id,id) ON DELETE CASCADE
);
ALTER TABLE standard_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE standard_schedules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON standard_schedules;
CREATE POLICY tenant_isolation ON standard_schedules USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
GRANT SELECT,INSERT,UPDATE ON standard_schedules TO app_rw;
SELECT kernel_apply_org_freeze_policies();
