-- Round r11a db proof (run against r11ae2e right after the journey): the goal claim, its personal copy, the
-- derived_from edge back to it, the audit rows, and the recall row of the 「帮我规划一下」 turn.
\echo '== claims (kind / scope / status)'
SELECT claim_kind, scope_kind, (scope_kind = 'personal') AS personal, status, created_by, statement
  FROM claims WHERE org_id = 'org-kg-experience-eval' ORDER BY created_at, id;
\echo '== derived_from (personal copy -> session claim)'
SELECT e.relation, e.created_by, e.status, p.scope_kind AS src_scope, s.scope_kind AS dst_scope, s.claim_kind
  FROM ontology_edges e JOIN claims p ON p.id = e.src_id JOIN claims s ON s.id = e.dst_id
 WHERE e.org_id = 'org-kg-experience-eval' AND e.relation = 'derived_from';
\echo '== audit'
SELECT actor_kind, actor_id, action_type, scope_kind, pipeline_version, outcome
  FROM ontology_actions WHERE org_id = 'org-kg-experience-eval' ORDER BY created_at;
\echo '== turn recall rows (items: statement-free ids + channels)'
SELECT jsonb_path_query_array(items, '$[*].channels') AS channels, graph_degraded
  FROM kg_turn_recalls WHERE org_id = 'org-kg-experience-eval' ORDER BY created_at;
