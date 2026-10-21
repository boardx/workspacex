-- Verified webhook capability: app_rw retains SELECT-only snapshots and immutable intent history.
CREATE TABLE IF NOT EXISTS billing_stripe_bindings (
 subscription_ref text PRIMARY KEY, user_id text NOT NULL, binding_generation bigint NOT NULL,
 customer_ref text NOT NULL, synchronization_uncertain boolean NOT NULL DEFAULT false, UNIQUE(user_id,binding_generation)
);
INSERT INTO billing_stripe_bindings(subscription_ref,user_id,binding_generation,customer_ref) SELECT subscription_ref,user_id,binding_generation,customer_ref FROM billing_subscriptions WHERE customer_ref IS NOT NULL ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS billing_stripe_reconciliation (
 provider_event_id text PRIMARY KEY, intent_hash text, subscription_ref text NOT NULL, customer_ref text NOT NULL,
 reason text NOT NULL, received_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE billing_stripe_bindings IS 'kernel-no-tenant-data: verified owner-global subscription binding history; app_rw SELECT only. Retired subscriptions cannot replace current snapshots.';
COMMENT ON TABLE billing_stripe_reconciliation IS 'kernel-no-tenant-data: verified late or ambiguous checkout facts retained for manual reconciliation; no raw intent or payload. app_rw has no direct writes.';
REVOKE ALL ON billing_stripe_bindings,billing_stripe_reconciliation FROM PUBLIC,app_rw;
GRANT SELECT ON billing_stripe_bindings TO app_rw;
CREATE OR REPLACE FUNCTION billing_apply_stripe_event(p_event text,p_hash text,p_sub text,p_customer text,p_snapshot jsonb,p_checkout boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE i public.billing_purchase_intents%ROWTYPE; b public.billing_stripe_bindings%ROWTYPE; c public.billing_subscriptions%ROWTYPE;
 u text; g bigint; state text; result text := 'ok'; reason text;
BEGIN
 IF p_event !~ '^evt_[A-Za-z0-9_]+$' OR length(p_event)>255 THEN RAISE EXCEPTION 'invalid_event'; END IF;
 -- Serialize replay as well as cross-owner event-ID conflicts, before any writes.
 PERFORM pg_advisory_xact_lock(hashtextextended('billing-stripe-event:'||p_event,0));
 IF EXISTS(SELECT 1 FROM public.billing_webhook_events WHERE provider_event_id=p_event) THEN
   IF NOT EXISTS(SELECT 1 FROM public.billing_webhook_events WHERE provider_event_id=p_event AND provider='stripe' AND signature_verified AND result IN ('ok','ignored')) THEN RAISE EXCEPTION 'event_conflict'; END IF;
   RETURN 'done';
 END IF;
 IF p_sub IS NULL THEN
   INSERT INTO public.billing_webhook_events(provider,provider_event_id,signature_verified,result) VALUES('stripe',p_event,true,'ignored'); RETURN 'done';
 END IF;
 IF p_sub !~ '^sub_[A-Za-z0-9_]+$' OR p_customer !~ '^cus_[A-Za-z0-9_]+$' OR p_customer IS NULL THEN RAISE EXCEPTION 'invalid_binding'; END IF;
 SELECT * INTO b FROM public.billing_stripe_bindings WHERE subscription_ref=p_sub;
 IF p_checkout THEN
   SELECT * INTO i FROM public.billing_purchase_intents WHERE intent_hash=p_hash;
   u := i.user_id;
 ELSE u := b.user_id;
 END IF;
 IF u IS NULL THEN RETURN 'retry'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('billing-subscription:'||u,0));
 SELECT * INTO c FROM public.billing_subscriptions WHERE user_id=u FOR UPDATE;
 IF p_checkout THEN
   SELECT * INTO i FROM public.billing_purchase_intents WHERE intent_hash=p_hash FOR UPDATE;
   IF b.user_id IS NOT NULL THEN
     IF b.user_id<>u OR i.consumed_subscription_ref IS DISTINCT FROM p_sub THEN reason:='binding_conflict'; END IF;
   ELSIF i.consumed_subscription_ref IS NOT NULL THEN reason:='intent_consumed';
   ELSIF i.expires_at<=now() THEN reason:='intent_expired';
   ELSIF i.expected_generation<>COALESCE(c.binding_generation,0) OR COALESCE(c.synchronization_uncertain,false) OR EXISTS(SELECT 1 FROM public.billing_stripe_bindings WHERE user_id=u AND synchronization_uncertain AND binding_generation>=COALESCE(c.binding_generation,0)) OR (c.user_id IS NOT NULL AND c.status NOT IN ('canceled','incomplete_expired')) THEN reason:='generation_or_status_conflict';
   END IF;
   IF reason IS NOT NULL THEN
     INSERT INTO public.billing_stripe_reconciliation(provider_event_id,intent_hash,subscription_ref,customer_ref,reason) VALUES(p_event,p_hash,p_sub,p_customer,reason);
     result:='ignored';
   ELSIF b.user_id IS NULL THEN
     g:=COALESCE(c.binding_generation,0)+1;
   ELSE g:=b.binding_generation;
   END IF;
 ELSE g:=b.binding_generation;
 END IF;
 IF reason IS NULL THEN
   IF b.user_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.billing_stripe_bindings WHERE user_id=u AND binding_generation>g) THEN result:='ignored';
   ELSE
     IF b.user_id IS NOT NULL AND b.customer_ref<>p_customer THEN
       UPDATE public.billing_stripe_bindings SET synchronization_uncertain=true WHERE subscription_ref=p_sub;
       UPDATE public.billing_subscriptions SET synchronization_uncertain=true WHERE user_id=u AND subscription_ref=p_sub AND binding_generation=g;
       RETURN 'retry';
     END IF;
     state:=p_snapshot->>'status';
     IF state IS NULL OR state NOT IN ('active','trialing','past_due','canceled','incomplete','unpaid','paused','incomplete_expired') THEN
       IF b.user_id IS NULL THEN
         INSERT INTO public.billing_stripe_bindings(subscription_ref,user_id,binding_generation,customer_ref,synchronization_uncertain) VALUES(p_sub,u,g,p_customer,true);
         UPDATE public.billing_purchase_intents SET consumed_subscription_ref=p_sub WHERE intent_hash=p_hash;
       ELSE UPDATE public.billing_stripe_bindings SET synchronization_uncertain=true WHERE subscription_ref=p_sub; END IF;
       UPDATE public.billing_subscriptions SET synchronization_uncertain=true WHERE user_id=u AND subscription_ref=p_sub AND binding_generation=g;
       RETURN 'retry';
     END IF;
     IF b.user_id IS NULL THEN
       INSERT INTO public.billing_stripe_bindings(subscription_ref,user_id,binding_generation,customer_ref) VALUES(p_sub,u,g,p_customer);
       UPDATE public.billing_purchase_intents SET consumed_subscription_ref=p_sub WHERE intent_hash=p_hash;
     END IF;
     UPDATE public.billing_stripe_bindings SET synchronization_uncertain=false WHERE subscription_ref=p_sub;
     INSERT INTO public.billing_subscriptions(user_id,customer_ref,subscription_ref,status,plan_ref,current_period_start,current_period_end,cancel_at_period_end,trial_start,trial_end,binding_generation,synchronization_uncertain)
       VALUES(u,p_customer,p_sub,state,p_snapshot->>'plan',to_timestamp((p_snapshot->>'start')::double precision),to_timestamp((p_snapshot->>'end')::double precision),(p_snapshot->>'cancel')::boolean,to_timestamp((p_snapshot->>'trialStart')::double precision),to_timestamp((p_snapshot->>'trialEnd')::double precision),g,false)
       ON CONFLICT(user_id) DO UPDATE SET customer_ref=EXCLUDED.customer_ref,subscription_ref=EXCLUDED.subscription_ref,status=EXCLUDED.status,plan_ref=EXCLUDED.plan_ref,current_period_start=EXCLUDED.current_period_start,current_period_end=EXCLUDED.current_period_end,cancel_at_period_end=EXCLUDED.cancel_at_period_end,trial_start=EXCLUDED.trial_start,trial_end=EXCLUDED.trial_end,binding_generation=EXCLUDED.binding_generation,synchronization_uncertain=false,updated_at=now();
   END IF;
 END IF;
 INSERT INTO public.billing_webhook_events(provider,provider_event_id,signature_verified,result) VALUES('stripe',p_event,true,result);
 RETURN 'done';
END $$;
REVOKE ALL ON FUNCTION billing_apply_stripe_event(text,text,text,text,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION billing_apply_stripe_event(text,text,text,text,jsonb,boolean) TO app_rw;
