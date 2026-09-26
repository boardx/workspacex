\pset pager off
\echo '== org extraction gate row'
SELECT org_id, enabled, updated_by FROM kg_org_extraction_settings WHERE org_id = 'org-kg-experience-eval';
\echo '== threads (project_id / visibility / creator)'
SELECT id, project_id, visibility_scope, created_by, title FROM chat_threads WHERE org_id = 'org-kg-experience-eval' ORDER BY created_at;
\echo '== claims (scope / kind / status / revoked)'
SELECT id, scope_kind, scope_id, claim_kind, status, created_by, revoked_at IS NOT NULL AS revoked, statement FROM claims WHERE org_id = 'org-kg-experience-eval' ORDER BY created_at, id;
\echo '== derived_from edges (personal copy -> source)'
SELECT src_id, dst_id, status, created_by FROM ontology_edges WHERE org_id = 'org-kg-experience-eval' AND relation = 'derived_from' ORDER BY created_at;
\echo '== claim -> message evidence (author_kind of the evidence message)'
SELECT e.claim_id, c.scope_kind, c.scope_id, m.author_kind, m.thread_id, e.message_id FROM claim_message_evidence e JOIN claims c ON c.id = e.claim_id JOIN chat_messages m ON m.id = e.message_id WHERE e.org_id = 'org-kg-experience-eval' ORDER BY e.created_at;
\echo '== kg_turn_recalls (run -> requester -> items)'
SELECT r.run_id, r.thread_id, r.requester_user_id, r.items FROM kg_turn_recalls r WHERE r.org_id = 'org-kg-experience-eval' ORDER BY r.created_at;
\echo '== agent answers: extraction queue leftovers (expect 0 rows) and whether any claim came from them'
SELECT m.id, m.thread_id, t.project_id, (SELECT count(*) FROM kg_extraction_queue q WHERE q.message_id = m.id) AS queued,
       (SELECT count(*) FROM claim_message_evidence e WHERE e.message_id = m.id) AS claims_from_it, left(m.body, 60) AS body
  FROM chat_messages m JOIN chat_threads t ON t.id = m.thread_id AND t.org_id = m.org_id
 WHERE m.org_id = 'org-kg-experience-eval' AND m.author_kind = 'agent' ORDER BY m.created_at;
