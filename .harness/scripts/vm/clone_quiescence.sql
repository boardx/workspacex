-- REVIEW DRAFT ONLY. Not executed. Always rolls back in this artifact.
-- Caller must bind exact temporary RDS ID/private peer, attempt, source5285,
-- original eight-stage receipts and independent clone-mutation approval FIRST.
-- All application/agent processes must be absent; outbound remains denied.
-- A trusted runner supplies wsx.clone_peer, wsx.clone_database, wsx.fixture_actor
-- in this same connection, not from URL/SQL printed to logs. No production DSN.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL row_security = off;
DO $guard$
BEGIN
  IF current_database() IS DISTINCT FROM current_setting('wsx.clone_database', false)
     OR inet_server_addr() IS DISTINCT FROM current_setting('wsx.clone_peer', false)::inet
     OR current_database() <> 'workspacex'
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user
                    AND (rolsuper OR rolbypassrls))
     OR nullif(current_setting('wsx.fixture_actor', false),'') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.credentials WHERE user_id=current_setting('wsx.fixture_actor',false)) THEN
    RAISE EXCEPTION 'CLONE_IDENTITY_OR_EXISTING_PRIVILEGE_REQUIRED';
  END IF;
END $guard$;
-- row_security=off is fail-closed, not RLS disablement. Do not add BYPASSRLS,
-- disable triggers, or ALTER table security to make this transaction work.
LOCK TABLE public.agent_run_interjections, public.agent_runs,
 public.kg_embedding_outbox, public.kg_extraction_queue,
 public.kg_extraction_state, public.mail_outbox,
 public.product_feedback, public.project_ai_settings, public.projects,
 public.standard_schedules, public.thread_message_queue,
 public.workflow_instances IN ACCESS EXCLUSIVE MODE;

-- Ordering matters: failing a run first can generate carry_over_pending via
-- workbench_journal_unapplied_interjections and later create another real run.
UPDATE public.agent_run_interjections SET status='not_applied'
 WHERE status IN ('queued','staged','carry_over_pending');
UPDATE public.agent_runs SET status='failed', error_code='RUN_INTERRUPTED'
 WHERE status NOT IN ('succeeded','failed','cancelled');
UPDATE public.thread_message_queue SET status='cancelled' WHERE status='pending';

-- Cancel every historical schedule and suppress its pending notification.
-- Do not modify pg-boss private schema/version or delete scheduler tables.
-- deliver() checks this row before dispatch; cancelled+notification=false exits.
UPDATE public.standard_schedules
 SET status='cancelled', notification_pending=false, revision=revision+1,
     notification_accepted_at=NULL, notification_read_at=NULL
 WHERE status<>'cancelled' OR notification_pending;

-- Preserve immutable pins. Existing trigger requires state_version + 1 and
-- prohibits touching terminal workflow states.
UPDATE public.workflow_instances
 SET status='cancelled', state_version=state_version+1,
     reason_code='CLONE_QUIESCENCE', updated_at=now()
 WHERE status NOT IN ('succeeded','failed','cancelled','rejected','needs_attention');

UPDATE public.mail_outbox SET status='failed', failure_category='CLONE_QUIESCENCE'
 WHERE status IN ('pending','delivering','retryable');
UPDATE public.kg_extraction_state SET enabled=false WHERE enabled;
UPDATE public.kg_extraction_queue SET attempts=greatest(attempts,3), locked_at=NULL
 WHERE attempts<3 OR locked_at IS NOT NULL;
UPDATE public.kg_embedding_outbox SET attempts=greatest(attempts,public.kg_embedding_max_attempts())
 WHERE attempts<public.kg_embedding_max_attempts();

-- Missing project_ai_settings means all sources allowed. Updating only rows
-- already present is insufficient: insert an explicit empty policy for EVERY
-- historical project. Actor is a verified existing clone actor, not fabricated.
INSERT INTO public.project_ai_settings(project_id,org_id,allowed_sources,updated_by,updated_at)
 SELECT id,org_id,ARRAY[]::text[],current_setting('wsx.fixture_actor'),now()
 FROM public.projects
 ON CONFLICT(project_id) DO UPDATE
 SET allowed_sources=ARRAY[]::text[], updated_by=EXCLUDED.updated_by, updated_at=EXCLUDED.updated_at;

-- Polling starts immediately when GitHub token is configured and can enqueue
-- notification mail. Remove historical associations ONLY in this clone.
-- Later fixture preparation may restore one explicitly reviewed association,
-- in a valid non-pollable feedback status, for the direct read-only journey.
UPDATE public.product_feedback
 SET github_issue_url=NULL, github_issue_number=NULL, github_issue_claimed_at=NULL
 WHERE github_issue_url IS NOT NULL OR github_issue_number IS NOT NULL
    OR github_issue_claimed_at IS NOT NULL;

DO $post$
BEGIN
 IF EXISTS(SELECT 1 FROM public.agent_runs WHERE status NOT IN ('succeeded','failed','cancelled'))
 OR EXISTS(SELECT 1 FROM public.agent_run_interjections WHERE status IN ('queued','staged','carry_over_pending'))
 OR EXISTS(SELECT 1 FROM public.thread_message_queue WHERE status='pending')
 OR EXISTS(SELECT 1 FROM public.standard_schedules WHERE status<>'cancelled' OR notification_pending)
 OR EXISTS(SELECT 1 FROM public.workflow_instances WHERE status NOT IN ('succeeded','failed','cancelled','rejected','needs_attention'))
 OR EXISTS(SELECT 1 FROM public.mail_outbox WHERE status IN ('pending','delivering','retryable'))
 OR EXISTS(SELECT 1 FROM public.kg_extraction_state WHERE enabled)
 OR EXISTS(SELECT 1 FROM public.kg_extraction_queue WHERE attempts<3)
 OR EXISTS(SELECT 1 FROM public.kg_embedding_outbox WHERE attempts<public.kg_embedding_max_attempts())
 OR EXISTS(SELECT 1 FROM public.projects p LEFT JOIN public.project_ai_settings s ON s.project_id=p.id
           WHERE s.project_id IS NULL OR cardinality(s.allowed_sources)<>0)
 OR EXISTS(SELECT 1 FROM public.product_feedback WHERE github_issue_number IS NOT NULL OR github_issue_url IS NOT NULL)
 THEN RAISE EXCEPTION 'CLONE_QUIESCENCE_POSTCONDITION'; END IF;
END $post$;
-- An eventual reviewed executor must report count-only before/after and bind
-- exact schema function/trigger hashes. Never emit rows/messages/recipients.
ROLLBACK;
