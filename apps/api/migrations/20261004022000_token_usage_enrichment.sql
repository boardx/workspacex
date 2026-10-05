-- Original calls remain append-only. Late original-provider usage enriches one call.
CREATE UNIQUE INDEX IF NOT EXISTS token_usage_events_id_org_enrichment_uniq ON token_usage_events(id,org_id);
CREATE TABLE IF NOT EXISTS token_usage_enrichments (
 org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 request_id text NOT NULL,
 revision bigint NOT NULL CHECK(revision>0),
 facts jsonb NOT NULL CHECK(jsonb_typeof(facts)='object'),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(org_id,request_id,revision),
 FOREIGN KEY(request_id,org_id) REFERENCES token_usage_events(id,org_id) ON DELETE CASCADE,
 CHECK(facts - ARRAY['tokens_total','tokens_prompt','tokens_completion','total_source','cost_micros','currency','price_version','tokens_cache_input','tokens_reasoning_output','native_unit','native_quantity','native_source']::text[] = '{}'::jsonb)
);
ALTER TABLE token_usage_enrichments ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_usage_enrichments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON token_usage_enrichments;
CREATE POLICY tenant_scope ON token_usage_enrichments USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
REVOKE ALL ON token_usage_enrichments FROM app_rw;
GRANT SELECT,INSERT ON token_usage_enrichments TO app_rw;
DROP TRIGGER IF EXISTS token_usage_enrichments_append_only ON token_usage_enrichments;
CREATE TRIGGER token_usage_enrichments_append_only BEFORE UPDATE OR DELETE ON token_usage_enrichments FOR EACH ROW EXECUTE FUNCTION f159_token_usage_append_only();
-- Validate monotonic enrichment even for direct SQL under the ordinary app role.
CREATE OR REPLACE FUNCTION guard_token_usage_enrichment() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE original token_usage_events; prior token_usage_events; proposed token_usage_events;
 old_facts jsonb; last_revision bigint; field text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.org_id||chr(31)||NEW.request_id,0));
 SELECT * INTO original FROM public.token_usage_events WHERE org_id=NEW.org_id AND id=NEW.request_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'usage enrichment original unavailable'; END IF;
 SELECT revision,facts INTO last_revision,old_facts FROM public.token_usage_enrichments
  WHERE org_id=NEW.org_id AND request_id=NEW.request_id ORDER BY revision DESC LIMIT 1;
 IF NEW.revision<>COALESCE(last_revision,0)+1 THEN RAISE EXCEPTION 'usage enrichment revision conflict'; END IF;
 SELECT * INTO prior FROM jsonb_populate_record(original,COALESCE(old_facts,'{}'::jsonb));
 SELECT * INTO proposed FROM jsonb_populate_record(prior,NEW.facts);
 FOREACH field IN ARRAY ARRAY['tokens_prompt','tokens_completion','tokens_cache_input','tokens_reasoning_output','cost_micros','currency','price_version','native_unit'] LOOP
  IF to_jsonb(prior)->field<>'null'::jsonb AND to_jsonb(prior)->field IS DISTINCT FROM to_jsonb(proposed)->field
   THEN RAISE EXCEPTION 'usage enrichment known value conflict'; END IF;
 END LOOP;
 IF prior.total_source<>'unknown' AND (prior.total_source IS DISTINCT FROM proposed.total_source OR prior.tokens_total IS DISTINCT FROM proposed.tokens_total)
  THEN RAISE EXCEPTION 'usage enrichment known total conflict'; END IF;
 IF prior.native_source='reported' AND (prior.native_source IS DISTINCT FROM proposed.native_source OR prior.native_quantity IS DISTINCT FROM proposed.native_quantity)
  THEN RAISE EXCEPTION 'usage enrichment known native conflict'; END IF;
 IF proposed.total_source IS NULL OR proposed.tokens_total IS NULL OR proposed.total_source NOT IN ('legacy','reported','unknown','not-applicable') OR proposed.tokens_total<0
  OR proposed.tokens_prompt<0 OR proposed.tokens_completion<0 OR proposed.tokens_cache_input<0 OR proposed.tokens_reasoning_output<0 OR proposed.cost_micros<0 OR proposed.native_quantity<0
  OR proposed.tokens_cache_input>proposed.tokens_prompt OR proposed.tokens_reasoning_output>proposed.tokens_completion
  OR (proposed.cost_micros IS NOT NULL AND (proposed.currency IS NULL OR proposed.price_version IS NULL))
  OR (proposed.cost_micros IS NULL AND (proposed.currency IS NOT NULL OR proposed.price_version IS NOT NULL))
  OR (proposed.total_source='unknown' AND proposed.tokens_total<>0)
  THEN RAISE EXCEPTION 'usage enrichment invalid dimensions'; END IF;
 IF NOT (
  (proposed.native_unit IS NULL AND proposed.native_quantity IS NULL AND proposed.native_source IS NULL AND proposed.total_source<>'not-applicable') OR
  (proposed.native_unit IS NOT NULL AND proposed.native_unit IN ('image','pixel','millisecond','microsecond','character','request')
   AND proposed.native_source IS NOT NULL AND proposed.native_source IN ('reported','estimated','unknown')
   AND ((proposed.native_source='unknown' AND proposed.native_quantity IS NULL) OR (proposed.native_source IN ('reported','estimated') AND proposed.native_quantity IS NOT NULL AND proposed.native_quantity>=0))
   AND proposed.total_source IN ('reported','unknown','not-applicable')
   AND (proposed.total_source<>'not-applicable' OR (proposed.tokens_total=0 AND proposed.tokens_prompt IS NULL AND proposed.tokens_completion IS NULL AND proposed.tokens_cache_input IS NULL AND proposed.tokens_reasoning_output IS NULL))
   AND (proposed.native_source='reported' OR proposed.total_source='reported' OR proposed.cost_micros IS NULL))
 ) THEN RAISE EXCEPTION 'usage enrichment invalid native dimensions'; END IF;
 NEW.received_at:=clock_timestamp();
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS token_usage_enrichment_validate ON token_usage_enrichments;
CREATE TRIGGER token_usage_enrichment_validate BEFORE INSERT ON token_usage_enrichments FOR EACH ROW EXECUTE FUNCTION guard_token_usage_enrichment();
-- Security invoker: no bypass. Original lifecycle/window/cursor/subject are never overridden.
CREATE OR REPLACE FUNCTION effective_token_usage(as_of timestamptz DEFAULT 'infinity'::timestamptz)
RETURNS SETOF token_usage_events LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT effective.* FROM public.token_usage_events original
 LEFT JOIN LATERAL (SELECT facts FROM public.token_usage_enrichments r
  WHERE r.org_id=original.org_id AND r.request_id=original.id AND r.received_at<=as_of
  ORDER BY revision DESC LIMIT 1) revision ON true
 CROSS JOIN LATERAL jsonb_populate_record(original,COALESCE(revision.facts,'{}'::jsonb)) effective
 WHERE original.occurred_at<=as_of
$$;
REVOKE ALL ON FUNCTION effective_token_usage(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION effective_token_usage(timestamptz) TO app_rw;
SELECT kernel_apply_org_freeze_policies();

-- Preserve the existing count-only telemetry contract and permissions.
CREATE OR REPLACE FUNCTION kernel_usage_counts_for_report(p_start timestamptz, p_end timestamptz)
RETURNS TABLE(run_count bigint, token_count bigint, seat_count bigint, organization_count bigint, capability_runs jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT
    (SELECT count(*) FROM agent_runs r JOIN organizations o ON o.id = r.org_id AND o.kind = 'organization'
      WHERE r.created_at > p_start AND r.created_at <= p_end),
    (SELECT coalesce(sum(t.tokens_total), 0)::bigint FROM effective_token_usage() t JOIN organizations o ON o.id = t.org_id AND o.kind = 'organization'
      WHERE t.occurred_at > p_start AND t.occurred_at <= p_end),
    (SELECT count(DISTINCT m.user_id) FROM org_memberships m JOIN organizations o ON o.id = m.org_id AND o.kind = 'organization'),
    (SELECT count(*) FROM organizations o WHERE o.kind = 'organization'),
    (SELECT coalesce(jsonb_object_agg(c.capability_id, c.n), '{}'::jsonb) FROM (
      SELECT v.manifest->>'capabilityId' AS capability_id, count(DISTINCT r.id) AS n
        FROM agent_runs r JOIN organizations o ON o.id = r.org_id AND o.kind = 'organization'
        CROSS JOIN LATERAL jsonb_array_elements_text(r.skill_version_ids) AS sv(version_id)
        JOIN skill_versions v ON v.id = sv.version_id
       WHERE r.created_at > p_start AND r.created_at <= p_end
         AND v.manifest->>'capabilityId' ~ '^(WX-S[0-9]+|[a-z][a-z0-9]*-[A-Za-z0-9._-]{1,48})$'
       GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 500) c)
$$;

-- Keep the application writer INSERT-only. The ordinary tenant INSERT route owns
-- both first receipt and monotonic late enrichment; foreign key collisions reject.
CREATE OR REPLACE FUNCTION reconcile_token_usage_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior token_usage_events; merged jsonb; incoming jsonb; field text;
 fact_keys text[]:=ARRAY['tokens_total','tokens_prompt','tokens_completion','total_source','cost_micros','currency','price_version','tokens_cache_input','tokens_reasoning_output','native_unit','native_quantity','native_source'];
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.org_id||chr(31)||NEW.id,0));
 SELECT * INTO prior FROM public.effective_token_usage() WHERE org_id=NEW.org_id AND id=NEW.id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF ROW(prior.user_id,prior.run_id,prior.model_provider,prior.model_id,prior.project_id,prior.thread_id,prior.agent_id,prior.call_purpose,prior.execution_attempt_id,prior.subtask_id,prior.request_started_at)
  IS DISTINCT FROM ROW(NEW.user_id,NEW.run_id,NEW.model_provider,NEW.model_id,NEW.project_id,NEW.thread_id,NEW.agent_id,NEW.call_purpose,NEW.execution_attempt_id,NEW.subtask_id,NEW.request_started_at)
  THEN RAISE EXCEPTION 'usage receipt identity or lifecycle conflict'; END IF;
 -- Late supplier receipt may have a later outcome/end; retain the original
 -- immutable lifecycle and only enrich counters, never move the accounting window.
 merged:='{}'::jsonb;incoming:=to_jsonb(NEW);
 FOREACH field IN ARRAY fact_keys LOOP merged:=merged||jsonb_build_object(field,to_jsonb(prior)->field); END LOOP;
 FOREACH field IN ARRAY fact_keys LOOP
  IF incoming->field='null'::jsonb THEN CONTINUE; END IF;
  IF field IN ('total_source','tokens_total') AND NEW.total_source='unknown' THEN CONTINUE; END IF;
  IF field IN ('native_source','native_quantity') AND (NEW.native_source IS NULL OR NEW.native_source='unknown') THEN CONTINUE; END IF;
  IF merged->field='null'::jsonb
   OR (field IN ('total_source','tokens_total') AND prior.total_source='unknown')
   OR (field IN ('native_source','native_quantity') AND prior.native_source IN ('unknown','estimated'))
   THEN merged:=merged||jsonb_build_object(field,incoming->field);
  ELSIF merged->field IS DISTINCT FROM incoming->field THEN RAISE EXCEPTION 'usage enrichment known value conflict'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM unnest(fact_keys) key WHERE to_jsonb(prior)->key IS DISTINCT FROM merged->key) THEN
  INSERT INTO public.token_usage_enrichments(org_id,request_id,revision,facts)
   SELECT NEW.org_id,NEW.id,COALESCE(max(revision),0)+1,merged FROM public.token_usage_enrichments WHERE org_id=NEW.org_id AND request_id=NEW.id;
 END IF;
 RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS token_usage_receipt_reconcile ON token_usage_events;
CREATE TRIGGER token_usage_receipt_reconcile BEFORE INSERT ON token_usage_events FOR EACH ROW EXECUTE FUNCTION reconcile_token_usage_receipt();
