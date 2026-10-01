-- Round 9 (#4302): state of the owner's decisions after the journey (run with psql against the r09e2e db).
\pset pager off
\echo '== claims (owner personal space + the two personal threads) =='
SELECT c.id, c.scope_kind, CASE WHEN c.scope_kind = 'personal' THEN 'owner' ELSE c.scope_id END AS scope,
       c.statement, c.status, c.revoked_at IS NOT NULL AS revoked, c.revocation_reason, c.created_by
  FROM claims c
 WHERE c.org_id = 'org-kg-experience-eval' AND c.claim_kind = 'decision'
 ORDER BY c.created_at, c.id;
\echo '== kg_supersede_notices =='
SELECT x.id, x.thread_id, n.statement AS newer, o.statement AS older, o.scope_kind AS older_scope, x.status, x.undone_by
  FROM kg_supersede_notices x JOIN claims n ON n.id = x.newer_claim_id JOIN claims o ON o.id = x.older_claim_id
 WHERE x.org_id = 'org-kg-experience-eval';
\echo '== derived_from edges (personal -> session) =='
SELECT d.src_id AS personal, d.dst_id AS source, d.created_by, d.status
  FROM ontology_edges d
 WHERE d.org_id = 'org-kg-experience-eval' AND d.relation = 'derived_from' ORDER BY d.created_at;
\echo '== human actions (audit) =='
SELECT a.scope_kind, a.action_type, a.actor_kind, a.outcome, a.created_at
  FROM ontology_actions a
 WHERE a.org_id = 'org-kg-experience-eval' AND a.actor_kind = 'human' ORDER BY a.created_at;
