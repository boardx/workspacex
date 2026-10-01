-- Round 10 (#4309): database state after the cross-session journey (run with psql against the r10e2e db).
\pset pager off
\echo '== org extraction gate row'
SELECT org_id, enabled FROM kg_org_extraction_settings WHERE org_id = 'org-kg-experience-eval';
\echo '== threads (project_id / visibility / creator)'
SELECT id, project_id, visibility_scope, created_by, title FROM chat_threads WHERE org_id = 'org-kg-experience-eval' ORDER BY created_at;
\echo '== decisions (scope / status / revoked / reason / supersedes)'
SELECT c.id, c.scope_kind, CASE WHEN c.scope_kind = 'personal' THEN c.scope_id ELSE c.scope_id END AS scope, c.statement, c.status,
       c.revoked_at IS NOT NULL AS revoked, c.revocation_reason, c.created_by, c.supersedes_claim_id
  FROM claims c WHERE c.org_id = 'org-kg-experience-eval' ORDER BY c.created_at, c.id;
\echo '== derived_from edges (personal copy -> session source)'
SELECT src_id AS personal, dst_id AS source, status, created_by FROM ontology_edges
 WHERE org_id = 'org-kg-experience-eval' AND relation = 'derived_from' ORDER BY created_at;
\echo '== kg_supersede_notices (#4290 auto)'
SELECT x.id, x.thread_id, n.statement AS newer, o.statement AS older, o.scope_kind AS older_scope, x.status, x.undone_by
  FROM kg_supersede_notices x JOIN claims n ON n.id = x.newer_claim_id JOIN claims o ON o.id = x.older_claim_id
 WHERE x.org_id = 'org-kg-experience-eval' ORDER BY x.created_at;
\echo '== kg_conflict_prompts (#4290 card; expect exactly one possible_change, resolved keep_both, none for the 「我反对」 sentence)'
SELECT p.id, p.thread_id, p.kind, n.statement AS newer, o.statement AS older, p.status, p.resolved_by
  FROM kg_conflict_prompts p JOIN claims n ON n.id = p.newer_claim_id JOIN claims o ON o.id = p.older_claim_id
 WHERE p.org_id = 'org-kg-experience-eval' ORDER BY p.created_at;
\echo '== kg_turn_recalls (thread -> requester -> recalled claim ids)'
SELECT r.thread_id, r.requester_user_id, jsonb_path_query_array(r.items, '$[*].claimId') AS claim_ids
  FROM kg_turn_recalls r WHERE r.org_id = 'org-kg-experience-eval' ORDER BY r.created_at;
\echo '== agent answers: extraction queue leftovers and claims evidenced by them (project answers must be 0 / 0)'
SELECT m.id, m.thread_id, t.project_id, (SELECT count(*) FROM kg_extraction_queue q WHERE q.message_id = m.id) AS queued,
       (SELECT count(*) FROM claim_message_evidence e WHERE e.message_id = m.id) AS claims_from_it, left(m.body, 60) AS body
  FROM chat_messages m JOIN chat_threads t ON t.id = m.thread_id AND t.org_id = m.org_id
 WHERE m.org_id = 'org-kg-experience-eval' AND m.author_kind = 'agent' ORDER BY m.created_at;
\echo '== human actions (audit)'
SELECT a.scope_kind, a.action_type, a.actor_kind, a.outcome, a.created_at FROM ontology_actions a
 WHERE a.org_id = 'org-kg-experience-eval' AND a.actor_kind = 'human' ORDER BY a.created_at;
