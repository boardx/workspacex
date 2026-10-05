-- Native invoices and partial Token observations are independent dimensions.
-- Example: DashScope Qwen-ASR reports seconds and output text Tokens but no total.
-- https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference (DashScope synchronous response)
-- tokens_total=0 with total_source='not-applicable' is an N/A sentinel, never reported zero
-- and never a Token tariff. Preserve supplier-reported partials without deriving a total.
-- No receipt UPDATE/backfill, price, plan, quota, RLS, grant, or append-only trigger changes.
ALTER TABLE token_usage_events DROP CONSTRAINT IF EXISTS token_usage_native_dimension_check;
ALTER TABLE token_usage_events ADD CONSTRAINT token_usage_native_dimension_check CHECK(
   (native_unit IS NULL AND native_quantity IS NULL AND native_source IS NULL AND total_source<>'not-applicable') OR
   (native_unit IS NOT NULL AND native_unit IN ('image','pixel','millisecond','microsecond','character','request')
    AND native_source IS NOT NULL AND native_source IN ('reported','estimated','unknown')
    AND ((native_source='unknown' AND native_quantity IS NULL) OR (native_source IN ('reported','estimated') AND native_quantity IS NOT NULL AND native_quantity>=0))
    AND total_source IN ('reported','unknown','not-applicable')
    AND (total_source<>'not-applicable' OR (tokens_total=0))
    AND (native_source='reported' OR total_source='reported' OR cost_micros IS NULL)));

-- Existing nonnegative/subset/known-value immutability checks remain authoritative.
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
   AND (proposed.total_source<>'not-applicable' OR (proposed.tokens_total=0))
   AND (proposed.native_source='reported' OR proposed.total_source='reported' OR proposed.cost_micros IS NULL))
 ) THEN RAISE EXCEPTION 'usage enrichment invalid native dimensions'; END IF;
 NEW.received_at:=clock_timestamp();
 RETURN NEW;
END;
$$;
