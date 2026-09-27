\pset pager off
\echo '== owner claims (scope, kind, status, reason, validity, todo)'
SELECT c.id, c.scope_kind, c.claim_kind, c.status, c.revocation_reason, c.valid_from, c.valid_to, c.todo_status, c.due_at, c.statement
  FROM claims c WHERE c.org_id = 'org-kg-experience-eval'
   AND (c.scope_id = 'user-kg-eval-owner' OR c.scope_id IN (SELECT id FROM chat_threads WHERE created_by = 'user-kg-eval-owner'))
 ORDER BY c.created_at, c.id;
\echo '== supersede notices'
SELECT id, thread_id, newer_claim_id, older_claim_id, status, restore->'claims' AS restore_claims FROM kg_supersede_notices
 WHERE org_id = 'org-kg-experience-eval' ORDER BY created_at;
\echo '== possible_change cards'
SELECT id, thread_id, kind, status, newer_claim_id, older_claim_id FROM kg_conflict_prompts WHERE org_id = 'org-kg-experience-eval' ORDER BY created_at;
\echo '== derived_from edges into the owner personal space'
SELECT d.src_id, d.dst_id, d.status, d.created_by FROM ontology_edges d JOIN claims p ON p.id = d.src_id
 WHERE d.org_id = 'org-kg-experience-eval' AND d.relation = 'derived_from' AND p.scope_kind = 'personal' ORDER BY d.created_at;
\echo '== human setTodoStatus audit'
SELECT scope_kind, actor_kind, actor_id, payload FROM ontology_actions
 WHERE org_id = 'org-kg-experience-eval' AND action_type = 'setTodoStatus' ORDER BY created_at, id;
