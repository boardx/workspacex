-- Round S5 db proof (run against s5e2e right after the journey): the owner's personal claims, the serves_goal edge
-- (created by the model, high confidence), the goal-link audit row, briefing preference and events, and the recall rows.
\echo '== personal claims (owner)'
SELECT claim_kind, status, created_by, statement FROM claims
 WHERE org_id = 'org-kg-experience-eval' AND scope_kind = 'personal' ORDER BY created_at, id;
\echo '== serves_goal edges'
SELECT e.status, e.created_by, e.scope_kind, s.claim_kind AS src_kind, s.statement AS src, d.claim_kind AS dst_kind, d.statement AS dst
  FROM ontology_edges e JOIN claims s ON s.id = e.src_id AND s.org_id = e.org_id JOIN claims d ON d.id = e.dst_id AND d.org_id = e.org_id
 WHERE e.org_id = 'org-kg-experience-eval' AND e.relation = 'serves_goal';
\echo '== goal-link audit'
SELECT actor_kind, actor_id, action_type, payload->'confidence' AS confidence, outcome
  FROM ontology_actions WHERE org_id = 'org-kg-experience-eval' AND action_type = 'setGoalLink' ORDER BY created_at;
\echo '== briefing preference / events (ids only, no text)'
SELECT user_id, dismissed FROM kg_briefing_preferences WHERE org_id = 'org-kg-experience-eval';
SELECT user_id, event, item_ids FROM kg_briefing_events WHERE org_id = 'org-kg-experience-eval' ORDER BY id;
\echo '== turn recall rows (channels only)'
SELECT thread_id, jsonb_path_query_array(items, '$[*].channels') AS channels FROM kg_turn_recalls
 WHERE org_id = 'org-kg-experience-eval' ORDER BY created_at;
